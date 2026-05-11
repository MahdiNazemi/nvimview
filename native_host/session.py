from __future__ import annotations

import fcntl
import os
import pty
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
from base64 import b64decode, b64encode
from collections.abc import Callable
from pathlib import Path
from typing import Any

from native_host.nvim import (
    build_nvim_args,
    diagnose_nvim,
    resolve_nvim_executable,
    validate_nvim,
    validate_nvim_filetype,
)
from native_host.paths import (
    cleanup_old_snapshots,
    decode_file_url,
    find_git_root,
    find_project_root,
    safe_temp_snapshot,
)
from native_host.protocol import fragment_message, write_message

Writer = Callable[[dict[str, Any]], None]
CUSTOM_OSC_PREFIXES = (
    b"\x1b]777;NvimViewDirty=",
    b"\x1b]777;NvimViewTheme=",
    b"\x1b]777;NvimViewSessionReady=",
)


def set_pty_size(fd: int, cols: int, rows: int) -> None:
    packed = struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)


def descendant_pids(root_pid: int) -> list[int]:
    try:
        result = subprocess.run(
            ["ps", "-axo", "pid=,ppid="],
            capture_output=True,
            check=True,
            text=True,
            timeout=2,
        )
    except Exception:  # noqa: BLE001
        return []

    children: dict[int, list[int]] = {}
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        try:
            pid, ppid = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        children.setdefault(ppid, []).append(pid)

    descendants: list[int] = []
    pending = list(children.get(root_pid, []))
    while pending:
        pid = pending.pop()
        descendants.append(pid)
        pending.extend(children.get(pid, []))
    return descendants


def nvim_pids_for_rpc_dir(rpc_dir: Path) -> list[int]:
    text = str(rpc_dir)
    if not text:
        return []
    try:
        result = subprocess.run(
            ["ps", "-axo", "pid=,comm=,command="],
            capture_output=True,
            check=True,
            text=True,
            timeout=2,
        )
    except Exception:  # noqa: BLE001
        return []

    own_pid = os.getpid()
    matches = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(maxsplit=2)
        if len(parts) != 3:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        command_name = Path(parts[1]).name
        command = parts[2]
        if pid != own_pid and command_name == "nvim" and text in command:
            matches.append(pid)
    return matches


def signal_process_groups(pids: set[int], sig: signal.Signals) -> None:
    pgids: set[int] = set()
    for pid in pids:
        try:
            pgids.add(os.getpgid(pid))
        except ProcessLookupError:
            pass
    for pgid in pgids:
        try:
            os.killpg(pgid, sig)
        except ProcessLookupError:
            pass


def signal_process_tree(root_pid: int, sig: signal.Signals) -> None:
    signal_process_groups({root_pid, *descendant_pids(root_pid)}, sig)


def signal_nvim_processes_for_rpc_dir(rpc_dir: Path, sig: signal.Signals) -> None:
    signal_process_groups(set(nvim_pids_for_rpc_dir(rpc_dir)), sig)


def terminate_nvim_processes_for_rpc_dir(rpc_dir: Path) -> bool:
    had_matches = bool(nvim_pids_for_rpc_dir(rpc_dir))
    if not had_matches:
        return False
    signal_nvim_processes_for_rpc_dir(rpc_dir, signal.SIGTERM)
    deadline = time.monotonic() + 0.25
    while nvim_pids_for_rpc_dir(rpc_dir) and time.monotonic() < deadline:
        time.sleep(0.025)
    if nvim_pids_for_rpc_dir(rpc_dir):
        signal_nvim_processes_for_rpc_dir(rpc_dir, signal.SIGKILL)
    return had_matches


def _control_suffix_length(data: bytes) -> int:
    max_length = min(len(data), max(len(prefix) for prefix in CUSTOM_OSC_PREFIXES))
    for length in range(max_length, 0, -1):
        suffix = data[-length:]
        if any(prefix.startswith(suffix) for prefix in CUSTOM_OSC_PREFIXES):
            return length
    return 0


def _control_terminator(buffer: bytes, start: int) -> tuple[int, int] | None:
    bel_end = buffer.find(b"\x07", start)
    st_end = buffer.find(b"\x1b\\", start)
    candidates = []
    if bel_end >= 0:
        candidates.append((bel_end, bel_end + 1))
    if st_end >= 0:
        candidates.append((st_end, st_end + 2))
    return min(candidates) if candidates else None


class NativeSession:
    def __init__(self, writer: Writer) -> None:
        self._writer = writer
        self._write_lock = threading.Lock()
        self._process: subprocess.Popen[bytes] | None = None
        self._pty_fd: int | None = None
        self._reader_thread: threading.Thread | None = None
        self._rpc: Any = None
        self._file_path: Path | None = None
        self._temp_snapshot: Any = None
        self._rpc_dir: Path | None = None
        self._rpc_path: Path | None = None
        self._dirty_status_path: Path | None = None
        self._session_script_path: Path | None = None
        self._pty_control_buffer = b""
        self._last_dirty_status: bool | None = None
        self._session_script_ready = threading.Event()
        self._closing = False

    def _write(self, message: dict[str, Any]) -> None:
        with self._write_lock:
            self._writer(message)

    def launch(self, message: dict[str, Any]) -> None:
        if self._process is not None:
            self.close()
        self._session_script_ready.clear()
        validate_nvim_filetype(message.get("nvimFiletype", ""))

        try:
            import pynvim  # type: ignore[import-not-found]
        except ImportError:
            self._write(
                {
                    "type": "error",
                    "message": (
                        "Python package pynvim is not installed for the native host."
                    ),
                }
            )
            return

        executable = resolve_nvim_executable(message.get("nvimExecutable", ""))
        version = validate_nvim(executable)
        file_path, temp_snapshot = self._resolve_file(message)
        self._file_path = file_path
        self._temp_snapshot = temp_snapshot
        try:
            cwd = Path(
                message.get("cwd")
                or find_project_root(file_path, message.get("projectRootMarkers"))
                or find_git_root(file_path)
                or file_path.parent
            )
            cols = int(message.get("cols", 120))
            rows = int(message.get("rows", 40))
            self._rpc_dir = Path(tempfile.mkdtemp(prefix="nvimview-rpc-"))
            self._rpc_path = self._rpc_dir / "nvim.sock"
            self._dirty_status_path = self._rpc_dir / "dirty"
            self._session_script_path = self._rpc_dir / "session.vim"
            self._write_session_script(
                file_path,
                str(message.get("mouseMode", "selection")),
            )
            args = build_nvim_args(
                executable=executable,
                file_path=str(file_path),
                read_only=bool(message.get("readOnly", False)),
                nvim_filetype=message.get("nvimFiletype", ""),
                listen_address=str(self._rpc_path),
                startup_command=message.get("startupCommand", ""),
                session_script_path=str(self._session_script_path),
            )
            self._start_process(args, cwd, cols, rows)
            self._rpc = self._connect_rpc(pynvim, self._rpc_path)
            self._session_script_ready.wait(timeout=2)
            self._write_terminal_theme()
            self._write(
                {
                    "type": "ready",
                    "nvimVersion": ".".join(str(part) for part in version),
                    "filePath": str(file_path),
                    "readOnly": bool(message.get("readOnly", False)),
                }
            )
        except Exception:
            self.close()
            raise

    def _resolve_file(self, message: dict[str, Any]) -> tuple[Path, Any]:
        if message.get("sourceKind") == "snapshot":
            temp_snapshot = safe_temp_snapshot(
                content=b64decode(message["snapshotBase64"]),
                suggested_name=message.get("suggestedName", "snapshot.txt"),
                nvim_filetype=message.get("nvimFiletype", "text"),
            )
            return temp_snapshot.path, temp_snapshot
        if message.get("fileUrl"):
            return decode_file_url(message["fileUrl"]), None
        return Path(message["filePath"]).resolve(), None

    def _start_process(
        self,
        args: list[str],
        cwd: Path,
        cols: int,
        rows: int,
    ) -> None:
        master_fd, slave_fd = pty.openpty()
        try:
            set_pty_size(slave_fd, cols, rows)
            env = {
                **os.environ,
                "TERM": "xterm-256color",
                "COLORTERM": "truecolor",
            }
            self._process = subprocess.Popen(
                args,
                cwd=str(cwd),
                env=env,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                close_fds=True,
                start_new_session=True,
            )
        finally:
            os.close(slave_fd)
        self._pty_fd = master_fd
        self._closing = False
        self._reader_thread = threading.Thread(target=self._read_pty, daemon=True)
        self._reader_thread.start()

    def _connect_rpc(self, pynvim: Any, socket_path: Path) -> Any:
        deadline = time.monotonic() + 5
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            if self._process and self._process.poll() is not None:
                break
            try:
                return pynvim.attach("socket", path=str(socket_path))
            except Exception as error:  # noqa: BLE001
                last_error = error
                time.sleep(0.05)
        message = "Neovim RPC socket did not become ready."
        if last_error is not None:
            message = f"{message} {last_error}"
        raise RuntimeError(message)

    def _write_session_script(
        self,
        file_path: Path,
        mouse_mode: str = "selection",
    ) -> None:
        if self._dirty_status_path is None or self._session_script_path is None:
            return
        self._dirty_status_path.write_text("0\n")
        self._dirty_status_path.chmod(0o600)
        # Selection mode clears mouse reporting so browser drag selection works.
        # Neovim mouse mode intentionally leaves the user's configured mouse option.
        mouse_setup = ["set mouse="] if mouse_mode != "neovim" else []
        self._session_script_path.write_text(
            "\n".join(
                [
                    f"let s:target_file = {vim_string(str(file_path))}",
                    f"let s:dirty_file = {vim_string(str(self._dirty_status_path))}",
                    "function! s:CanonicalPath(path) abort",
                    "  if empty(a:path)",
                    "    return ''",
                    "  endif",
                    "  return fnamemodify(resolve(a:path), ':p')",
                    "endfunction",
                    "function! s:WriteDirty() abort",
                    "  let l:target = s:CanonicalPath(s:target_file)",
                    "  let l:dirty = 0",
                    "  for l:item in getbufinfo({'bufloaded': 1})",
                    "    let l:name = get(l:item, 'name', '')",
                    "    if l:name !=# '' && s:CanonicalPath(l:name) ==# l:target",
                    "      if getbufvar(l:item.bufnr, '&modified')",
                    "        let l:dirty = 1",
                    "      endif",
                    "      break",
                    "    endif",
                    "  endfor",
                    "  call writefile([string(l:dirty)], s:dirty_file)",
                    "  try",
                    (
                        "    call chansend(v:stderr, nr2char(27) . "
                        "']777;NvimViewDirty=' . string(l:dirty) . nr2char(7))"
                    ),
                    "  catch",
                    "  endtry",
                    "endfunction",
                    "function! s:TerminalCursorTheme() abort",
                    "  let l:cursor_bg = synIDattr(hlID('Cursor'), 'bg#')",
                    "  let l:cursor_fg = synIDattr(hlID('Cursor'), 'fg#')",
                    "  let l:cursor_reverse = synIDattr(hlID('Cursor'), 'reverse')",
                    "  let l:normal_fg = synIDattr(hlID('Normal'), 'fg#')",
                    "  let l:normal_bg = synIDattr(hlID('Normal'), 'bg#')",
                    "  if !empty(l:cursor_bg)",
                    (
                        "    return {'cursor': l:cursor_bg, 'accent': "
                        "!empty(l:cursor_fg) ? l:cursor_fg : "
                        "(!empty(l:normal_bg) ? l:normal_bg : '#000000')}"
                    ),
                    "  endif",
                    (
                        "  if l:cursor_reverse !=# '' && l:cursor_reverse !=# '0' "
                        "&& !empty(l:normal_fg)"
                    ),
                    (
                        "    return {'cursor': l:normal_fg, 'accent': "
                        "!empty(l:normal_bg) ? l:normal_bg : '#000000'}"
                    ),
                    "  endif",
                    "  return {}",
                    "endfunction",
                    "function! s:SyncTerminalCursor() abort",
                    "  let l:theme = s:TerminalCursorTheme()",
                    "  if empty(l:theme)",
                    "    return",
                    "  endif",
                    "  try",
                    (
                        "    call chansend(v:stderr, nr2char(27) . "
                        "']12;' . l:theme.cursor . nr2char(7))"
                    ),
                    (
                        "    call chansend(v:stderr, nr2char(27) . "
                        "']777;NvimViewTheme=' . l:theme.cursor . ',' . "
                        "l:theme.accent . nr2char(7))"
                    ),
                    "  catch",
                    "  endtry",
                    "endfunction",
                    "function! NvimViewFocusTargetFile() abort",
                    "  let l:target = s:CanonicalPath(s:target_file)",
                    "  for l:winnr in range(1, winnr('$'))",
                    "    let l:name = bufname(winbufnr(l:winnr))",
                    "    if l:name !=# '' && s:CanonicalPath(l:name) ==# l:target",
                    "      execute l:winnr . 'wincmd w'",
                    "      return",
                    "    endif",
                    "  endfor",
                    "endfunction",
                    "function! NvimViewNotifyReady() abort",
                    "  try",
                    (
                        "    call chansend(v:stderr, nr2char(27) . "
                        "']777;NvimViewSessionReady=1' . nr2char(7))"
                    ),
                    "  catch",
                    "  endtry",
                    "endfunction",
                    "augroup NvimViewDirty",
                    "  autocmd!",
                    (
                        "  autocmd TextChanged,TextChangedI,TextChangedP,"
                        "BufWritePost,BufReadPost,BufEnter,FocusLost * "
                        "call <SID>WriteDirty()"
                    ),
                    "augroup END",
                    "augroup NvimViewTerminalTheme",
                    "  autocmd!",
                    "  autocmd VimEnter,ColorScheme * call <SID>SyncTerminalCursor()",
                    "augroup END",
                    *mouse_setup,
                    "call <SID>SyncTerminalCursor()",
                    "call <SID>WriteDirty()",
                    "",
                ]
            )
        )

    def _read_pty(self) -> None:
        fd = self._pty_fd
        if fd is None:
            return
        try:
            while True:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                filtered = self._handle_pty_controls(data)
                if not filtered:
                    continue
                message = {
                    "type": "terminalOutput",
                    "dataBase64": b64encode(filtered).decode("ascii"),
                }
                for outgoing in fragment_message(message):
                    self._write(outgoing)
        finally:
            process = self._process
            if process is not None and not self._closing:
                try:
                    process.wait(timeout=1)
                except (subprocess.TimeoutExpired, TimeoutError):
                    pass
                else:
                    self._write({"type": "exit", "exitCode": process.returncode})

    def _handle_pty_controls(self, data: bytes) -> bytes:
        buffer = self._pty_control_buffer + data
        self._pty_control_buffer = b""
        output = bytearray()
        index = 0

        while index < len(buffer):
            starts = [
                (start, prefix)
                for prefix in CUSTOM_OSC_PREFIXES
                if (start := buffer.find(prefix, index)) >= 0
            ]
            if not starts:
                break

            start, prefix = min(starts, key=lambda item: item[0])
            output.extend(buffer[index:start])
            value_start = start + len(prefix)
            terminator = _control_terminator(buffer, value_start)
            if terminator is None:
                self._pty_control_buffer = buffer[start:]
                return bytes(output)

            value_end, end = terminator
            value = buffer[value_start:value_end]
            if prefix.endswith(b"NvimViewDirty="):
                if value in (b"0", b"1"):
                    self._emit_dirty_status(value == b"1")
                else:
                    output.extend(buffer[start:end])
            elif prefix.endswith(b"NvimViewTheme="):
                if not self._emit_terminal_theme(value):
                    output.extend(buffer[start:end])
            elif prefix.endswith(b"NvimViewSessionReady="):
                if value == b"1":
                    self._session_script_ready.set()
                else:
                    output.extend(buffer[start:end])
            index = end

        tail = buffer[index:]
        partial_length = _control_suffix_length(tail)
        if partial_length:
            output.extend(tail[:-partial_length])
            self._pty_control_buffer = tail[-partial_length:]
        else:
            output.extend(tail)
        return bytes(output)

    def _emit_terminal_theme(self, value: bytes) -> bool:
        try:
            text = value.decode("ascii")
        except UnicodeDecodeError:
            return False
        cursor, separator, accent = text.partition(",")
        if not separator:
            return False
        cursor_color = _valid_hex_color(cursor)
        accent_color = _valid_hex_color(accent)
        if not cursor_color:
            return False
        self._write(
            {
                "type": "terminalTheme",
                "theme": {
                    "cursor": cursor_color,
                    "cursorAccent": accent_color or "#000000",
                },
            }
        )
        return True

    def _emit_dirty_status(self, dirty: bool) -> None:
        if dirty == self._last_dirty_status:
            return
        self._last_dirty_status = dirty
        self._write({"type": "dirtyStatus", "dirty": dirty, "buffers": []})

    def handle(self, message: dict[str, Any]) -> None:
        message_type = message.get("type")
        if message_type == "diagnostics":
            self._write(
                {
                    "type": "diagnostics",
                    "nvim": diagnose_nvim(message.get("nvimExecutable", "")),
                }
            )
            return
        if message_type == "launch":
            try:
                self.launch(message)
            except Exception as error:  # noqa: BLE001
                self._write(
                    {
                        "type": "error",
                        "message": str(error),
                    }
                )
            return
        if self._process is None:
            self._write({"type": "error", "message": "Neovim session is not running."})
            return

        if message_type == "terminalInput":
            self._write_pty(str(message.get("data", "")).encode("utf-8"))
        elif message_type == "terminalInputBase64":
            self._write_pty(b64decode(message.get("dataBase64", "")))
        elif message_type == "resize":
            self._resize(
                int(message.get("cols", 120)),
                int(message.get("rows", 40)),
            )
        elif message_type == "dirtyStatus":
            self._write_dirty_status()
        elif message_type == "close":
            self.close()
        else:
            self._write(
                {"type": "error", "message": f"Unknown message type: {message_type}"}
            )

    def _write_pty(self, data: bytes) -> None:
        if self._pty_fd is not None and data:
            os.write(self._pty_fd, data)

    def _resize(self, cols: int, rows: int) -> None:
        if self._pty_fd is not None:
            set_pty_size(self._pty_fd, cols, rows)
        if self._process is not None and self._process.poll() is None:
            try:
                os.killpg(self._process.pid, signal.SIGWINCH)
            except ProcessLookupError:
                pass

    def _write_terminal_theme(self) -> None:
        if self._rpc is None:
            return
        try:
            highlights = self._rpc.eval(
                "{"
                "'cursor_bg': synIDattr(hlID('Cursor'), 'bg#'),"
                "'cursor_fg': synIDattr(hlID('Cursor'), 'fg#'),"
                "'cursor_reverse': synIDattr(hlID('Cursor'), 'reverse'),"
                "'normal_bg': synIDattr(hlID('Normal'), 'bg#'),"
                "'normal_fg': synIDattr(hlID('Normal'), 'fg#')"
                "}"
            )
        except Exception:  # noqa: BLE001
            return
        theme = cursor_theme_from_highlights(highlights)
        if theme:
            self._write({"type": "terminalTheme", "theme": theme})

    def _write_dirty_status(self) -> None:
        dirty = False
        if self._dirty_status_path is not None:
            try:
                dirty = self._dirty_status_path.read_text().strip() == "1"
            except OSError:
                dirty = False
        self._write({"type": "dirtyStatus", "dirty": dirty, "buffers": []})

    def close(self) -> None:
        process = self._process
        self._closing = True
        self._process = None
        rpc = self._rpc
        self._rpc = None
        pty_fd = self._pty_fd
        self._pty_fd = None
        temp_snapshot = self._temp_snapshot
        self._temp_snapshot = None
        rpc_dir = self._rpc_dir
        self._rpc_dir = None
        self._rpc_path = None
        self._dirty_status_path = None
        self._session_script_path = None
        self._file_path = None
        self._pty_control_buffer = b""
        self._last_dirty_status = None

        if process is None:
            if rpc is not None:
                try:
                    rpc.close()
                except Exception:  # noqa: BLE001
                    pass
            if temp_snapshot is not None:
                temp_snapshot.cleanup()
            if rpc_dir is not None:
                shutil.rmtree(rpc_dir, ignore_errors=True)
            return

        if pty_fd is not None and process.poll() is None:
            try:
                os.write(pty_fd, b"\x1b:qa!\r")
            except OSError:
                pass

        if pty_fd is not None:
            try:
                os.close(pty_fd)
            except OSError:
                pass
            pty_fd = None

        if process.poll() is None:
            deadline = time.monotonic() + 0.25
            while process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.025)
        if process.poll() is None:
            try:
                signal_process_tree(process.pid, signal.SIGTERM)
                process.wait(timeout=0.5)
            except (ProcessLookupError, subprocess.TimeoutExpired, TimeoutError):
                try:
                    signal_process_tree(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=0.5)
                except (subprocess.TimeoutExpired, TimeoutError):
                    pass
            except ProcessLookupError:
                pass
        if rpc_dir is not None and terminate_nvim_processes_for_rpc_dir(rpc_dir):
            try:
                process.wait(timeout=0.5)
            except (subprocess.TimeoutExpired, TimeoutError):
                pass
        if rpc is not None:
            try:
                rpc.close()
            except Exception:  # noqa: BLE001
                pass
        if temp_snapshot is not None:
            temp_snapshot.cleanup()
        if rpc_dir is not None:
            shutil.rmtree(rpc_dir, ignore_errors=True)


def vim_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _valid_hex_color(value: object) -> str:
    text = str(value or "")
    if len(text) == 7 and text.startswith("#"):
        try:
            int(text[1:], 16)
        except ValueError:
            return ""
        return text
    return ""


def cursor_theme_from_highlights(highlights: dict[str, object]) -> dict[str, str]:
    normal_fg = _valid_hex_color(highlights.get("normal_fg"))
    normal_bg = _valid_hex_color(highlights.get("normal_bg"))
    cursor_bg = _valid_hex_color(highlights.get("cursor_bg"))
    cursor_fg = _valid_hex_color(highlights.get("cursor_fg"))
    cursor_reverse = str(highlights.get("cursor_reverse") or "") not in ("", "0")

    if cursor_bg:
        return {
            "cursor": cursor_bg,
            "cursorAccent": cursor_fg or normal_bg or "#000000",
        }
    if cursor_reverse and normal_fg:
        return {
            "cursor": normal_fg,
            "cursorAccent": normal_bg or "#000000",
        }
    return {}


def run_native_host() -> int:
    from native_host.protocol import read_message

    cleanup_old_snapshots(max_age_seconds=24 * 60 * 60)
    stdout = sys.stdout.buffer

    def writer(message: dict[str, Any]) -> None:
        write_message(stdout, message)

    session = NativeSession(writer)
    stdin = sys.stdin.buffer
    try:
        while True:
            try:
                message = read_message(stdin)
            except EOFError:
                session.close()
                return 0
            session.handle(message)
    except KeyboardInterrupt:
        session.close()
        return 130
