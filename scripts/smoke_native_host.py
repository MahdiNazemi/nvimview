#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import struct
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "scripts" / "run_native_host.sh"


def encode_message(message: dict[str, Any]) -> bytes:
    payload = json.dumps(message, separators=(",", ":")).encode()
    return struct.pack("=I", len(payload)) + payload


def read_message(stream) -> dict[str, Any] | None:
    header = stream.read(4)
    if not header:
        return None
    length = struct.unpack("=I", header)[0]
    payload = stream.read(length)
    if len(payload) != length:
        raise EOFError("native message payload is truncated")
    return json.loads(payload.decode())


def vim_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def vim_fnameescape(path: Path) -> str:
    escaped = str(path).replace("\\", "\\\\")
    for char in (" ", "\t", "\n", "*", "[", "]", "{", "}", "?", "$", "%", "#", "|"):
        escaped = escaped.replace(char, f"\\{char}")
    return escaped


class Host:
    def __init__(self) -> None:
        self.process = subprocess.Popen(
            [str(HOST)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.messages: list[dict[str, Any]] = []
        self._terminal_buffer = b""
        self._write_lock = threading.Lock()
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def _read_loop(self) -> None:
        assert self.process.stdout is not None
        while True:
            message = read_message(self.process.stdout)
            if message is None:
                return
            self.messages.append(message)
            self._answer_terminal_queries(message)

    def _answer_terminal_queries(self, message: dict[str, Any]) -> None:
        if message.get("type") != "terminalOutput":
            return
        self._terminal_buffer = (
            self._terminal_buffer + base64.b64decode(message.get("dataBase64", ""))
        )[-64:]
        if b"\x1b[6n" in self._terminal_buffer:
            self.send({"type": "terminalInput", "data": "\x1b[1;1R"})
            self._terminal_buffer = b""

    def send(self, message: dict[str, Any]) -> None:
        assert self.process.stdin is not None
        with self._write_lock:
            self.process.stdin.write(encode_message(message))
            self.process.stdin.flush()

    def wait_for(self, predicate, timeout: float = 10) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for message in list(self.messages):
                if predicate(message):
                    return message
            if self.process.poll() is not None:
                stderr = self.process.stderr.read().decode(errors="replace")
                raise RuntimeError(
                    f"native host exited early: {self.process.returncode}\n{stderr}"
                )
            time.sleep(0.05)
        raise TimeoutError(f"timed out waiting; recent={self.messages[-5:]}")

    def close(self) -> None:
        self.send({"type": "close"})
        if self.process.stdin is not None:
            self.process.stdin.close()
        self.process.wait(timeout=5)
        if self.process.returncode != 0:
            stderr = self.process.stderr.read().decode(errors="replace")
            raise RuntimeError(
                f"native host exited with {self.process.returncode}\n{stderr}"
            )


def wait_for_file(path: Path, timeout: float = 3) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            return path.read_text()
        time.sleep(0.05)
    raise TimeoutError(f"{path} was not written")


def unquote_vim_string(value: str) -> str:
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def write_command(host: Host, command: str) -> None:
    host.send({"type": "terminalInput", "data": f"\x1b:{command}\r"})


def launch(
    tmp: Path,
    *,
    startup_command: str = "",
    source: Path | None = None,
    use_file_url: bool = False,
    project_root_markers: list[dict[str, str]] | None = None,
    cols: int = 120,
    rows: int = 32,
) -> tuple[Host, Path]:
    if source is None:
        source = tmp / "fixture.md"
        source.write_text("\n".join(f"line {index}" for index in range(1, 80)) + "\n")
    launch_message = {
        "type": "launch",
        "nvimFiletype": "markdown",
        "readOnly": False,
        "sourceKind": "local",
        "startupCommand": startup_command,
        "projectRootMarkers": project_root_markers
        or [
            {"path": ".git", "strategy": "highest"},
            {"path": "AGENTS.md", "strategy": "highest"},
            {"path": "CLAUDE.md", "strategy": "highest"},
            {"path": ".claude", "strategy": "highest"},
        ],
        "cols": cols,
        "rows": rows,
    }
    if use_file_url:
        launch_message["fileUrl"] = source.as_uri()
    else:
        launch_message["filePath"] = str(source)
    host = Host()
    host.send(launch_message)
    host.wait_for(lambda message: message.get("type") == "ready")
    return host, source


def write_eval(host: Host, output: Path, expr: str) -> str:
    write_command(
        host,
        f"call writefile([string({expr})], {vim_string(str(output))})",
    )
    return wait_for_file(output).strip()


def write_window_report(
    host: Host,
    output: Path,
    *,
    marker_var: str = "",
) -> list[dict[str, str | int]]:
    marker_expr = "0"
    if marker_var:
        marker_expr = f"getwinvar(v:val, {vim_string(marker_var)}, 0)"
    write_command(
        host,
        (
            "call writefile(map(range(1, winnr('$')), "
            "\"string(v:val) . '\\t' . string(winwidth(v:val)) . '\\t' . "
            "getwinvar(v:val, '&filetype') . '\\t' . "
            f'string({marker_expr})"), '
            f"{vim_string(str(output))})"
        ),
    )
    report = []
    for line in wait_for_file(output).splitlines():
        winnr, width, filetype, left_marker = line.split("\t", maxsplit=3)
        report.append(
            {
                "winnr": int(winnr),
                "width": int(width),
                "filetype": filetype,
                "leftMarker": int(left_marker),
            }
        )
    return report


def assert_custom_left_explorer_width(
    host: Host,
    output: Path,
    *,
    columns: int,
    marker_var: str = "",
) -> None:
    report = write_window_report(host, output, marker_var=marker_var)
    explorers = [
        item
        for item in report
        if item["filetype"] == "netrw" and (not marker_var or item["leftMarker"] == 1)
    ]
    assert len(explorers) == 1, report
    expected_width = int(columns * 33 / 100)
    actual_width = int(explorers[0]["width"])
    assert abs(actual_width - expected_width) <= 3, report


def test_key_input(tmp: Path) -> None:
    host, _source = launch(tmp)
    try:
        line_marker = tmp / "line.txt"
        leader_marker = tmp / "leader.txt"
        host.send({"type": "terminalInput", "data": "G"})
        host.send({"type": "terminalInput", "data": "gg"})
        assert write_eval(host, line_marker, "line('.')") == "1"

        host.send(
            {
                "type": "terminalInput",
                "data": (
                    "\x1b:nnoremap \\v "
                    f":call writefile(['leader'], {vim_string(str(leader_marker))})"
                    "<CR>\r"
                ),
            }
        )
        host.send({"type": "terminalInput", "data": "\\v"})
        assert wait_for_file(leader_marker).strip() == "leader"
    finally:
        host.close()


def test_dirty_state(tmp: Path) -> None:
    host, _source = launch(tmp)
    try:
        host.send({"type": "terminalInput", "data": "Ago dirty\x1b"})
        message = host.wait_for(
            lambda item: (
                item.get("type") == "dirtyStatus" and item.get("dirty") is True
            ),
            timeout=3,
        )
        assert message["buffers"] == []
    finally:
        host.close()


def test_project_root_for_file_url(tmp: Path) -> None:
    subprocess.run(["git", "init", "-q", str(tmp)], check=True)
    source_dir = tmp / "docs" / "nested"
    source_dir.mkdir(parents=True)
    source = source_dir / "linked.md"
    source.write_text("# linked\n")
    host, _source = launch(tmp, source=source, use_file_url=True)
    try:
        cwd_marker = tmp / "cwd.txt"
        cwd = unquote_vim_string(write_eval(host, cwd_marker, "getcwd()"))
        assert Path(cwd).resolve() == tmp.resolve()
    finally:
        host.close()


def test_startup_command_runs_after_file_open_and_focus_is_restored(tmp: Path) -> None:
    marker = tmp / "startup.txt"
    command = (
        f"call writefile([expand('%:t')], {vim_string(str(marker))})"
        " | leftabove vertical new"
    )
    host, source = launch(tmp, startup_command=command)
    try:
        assert wait_for_file(marker).strip() == source.name
        focused = tmp / "focused.txt"
        current_file = write_eval(host, focused, "expand('%:p')")
        assert Path(current_file.strip("'")).resolve() == source.resolve()
    finally:
        host.close()


def test_resize_reaches_neovim_vimresized(tmp: Path) -> None:
    marker = tmp / "resize.txt"
    command = (
        f"autocmd VimResized * call writefile([&columns . 'x' . &lines], "
        f"{vim_string(str(marker))})"
    )
    host, _source = launch(tmp, startup_command=command)
    try:
        host.send({"type": "resize", "cols": 150, "rows": 32})
        assert wait_for_file(marker).strip() == "150x32"
    finally:
        host.close()


def test_source_project_root(
    tmp: Path, source: Path, expected_root: Path | None
) -> None:
    host, _source = launch(tmp, source=source, use_file_url=True)
    try:
        cwd_marker = tmp / "source-root.txt"
        cwd = Path(
            unquote_vim_string(write_eval(host, cwd_marker, "getcwd()"))
        ).resolve()
        if expected_root is not None:
            assert cwd == expected_root.resolve()
        else:
            assert cwd == source.parent.resolve()
    finally:
        host.close()


def test_configured_left_explorer_mapping(
    tmp: Path,
    startup_command: str,
    marker_var: str = "",
) -> None:
    host, source = launch(tmp, startup_command=startup_command, cols=120, rows=32)
    try:
        assert_custom_left_explorer_width(
            host,
            tmp / "startup-windows.txt",
            columns=120,
            marker_var=marker_var,
        )
        focused = tmp / "startup-focused.txt"
        current_file = unquote_vim_string(write_eval(host, focused, "expand('%:p')"))
        assert Path(current_file).resolve() == source.resolve()

        for _ in range(3):
            host.send({"type": "terminalInput", "data": "\\v"})
            time.sleep(0.2)
        assert_custom_left_explorer_width(
            host,
            tmp / "leader-v-windows.txt",
            columns=120,
            marker_var=marker_var,
        )

        host.send({"type": "resize", "cols": 150, "rows": 32})
        time.sleep(0.2)
        assert_custom_left_explorer_width(
            host,
            tmp / "resized-windows.txt",
            columns=150,
            marker_var=marker_var,
        )
    finally:
        host.close()


def main() -> int:
    global HOST  # noqa: PLW0603

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", type=Path, default=HOST)
    parser.add_argument("--startup-command", default="")
    parser.add_argument("--left-explorer-window-var", default="")
    parser.add_argument("--expected-root", type=Path)
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()

    HOST = args.host
    with tempfile.TemporaryDirectory(prefix="nvimview-smoke-") as tmp_str:
        tmp = Path(tmp_str)
        test_key_input(tmp)
        test_dirty_state(tmp)
        test_project_root_for_file_url(tmp)
        if args.startup_command:
            marker = tmp / "custom-startup.txt"
            command = (
                f"call writefile(['custom'], {vim_string(str(marker))})"
                f" | {args.startup_command}"
            )
            test_configured_left_explorer_mapping(
                tmp,
                command,
                marker_var=args.left_explorer_window_var,
            )
            assert wait_for_file(marker).strip() == "custom"
        test_startup_command_runs_after_file_open_and_focus_is_restored(tmp)
        test_resize_reaches_neovim_vimresized(tmp)
        if args.source:
            test_source_project_root(tmp, args.source, args.expected_root)

    print("native host smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
