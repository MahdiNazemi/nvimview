import signal
from pathlib import Path

from native_host.session import (
    NativeSession,
    cursor_theme_from_highlights,
    signal_process_tree,
    terminate_nvim_processes_for_rpc_dir,
)


def test_launch_errors_are_structured_messages() -> None:
    messages = []
    session = NativeSession(messages.append)

    session.handle(
        {"type": "launch", "filePath": "/tmp/example.md", "nvimFiletype": "bad|type"}
    )

    assert messages
    assert messages[-1]["type"] == "error"
    assert "invalid Neovim filetype" in messages[-1]["message"]
    assert "trace" not in messages[-1]


def test_writer_is_serialized() -> None:
    messages = []
    session = NativeSession(messages.append)

    session._write({"type": "one"})  # noqa: SLF001
    session._write({"type": "two"})  # noqa: SLF001

    assert messages == [{"type": "one"}, {"type": "two"}]


def test_diagnostics_do_not_require_running_session(monkeypatch) -> None:
    messages = []
    session = NativeSession(messages.append)

    monkeypatch.setattr(
        "native_host.session.diagnose_nvim",
        lambda executable: {"ok": True, "executable": executable, "version": "0.12.0"},
    )

    session.handle({"type": "diagnostics", "nvimExecutable": "/opt/bin/nvim"})

    assert messages == [
        {
            "type": "diagnostics",
            "nvim": {
                "ok": True,
                "executable": "/opt/bin/nvim",
                "version": "0.12.0",
            },
        }
    ]


def test_close_sends_force_quit_before_closing_running_session(monkeypatch) -> None:
    calls = []

    class FakeRpc:
        def close(self):
            calls.append(("rpc.close",))

    class FakeProcess:
        pid = 1234
        closed = False

        def poll(self):
            return 0 if self.closed else None

    process = FakeProcess()

    def fake_write(fd, data):
        calls.append(("write", fd, data))

    def fake_close(fd):
        calls.append(("close", fd))
        process.closed = True

    monkeypatch.setattr("native_host.session.os.write", fake_write)
    monkeypatch.setattr("native_host.session.os.close", fake_close)

    session = NativeSession([].append)
    session._process = process  # noqa: SLF001
    session._pty_fd = 9  # noqa: SLF001
    session._rpc = FakeRpc()  # noqa: SLF001

    session.close()

    assert calls == [
        ("write", 9, b"\x1b:qa!\r"),
        ("close", 9),
        ("rpc.close",),
    ]


def test_dirty_status_is_false_without_tracker_file() -> None:
    messages = []

    session = NativeSession(messages.append)

    session._write_dirty_status()  # noqa: SLF001

    assert messages == [{"type": "dirtyStatus", "dirty": False, "buffers": []}]


def test_dirty_status_reads_tracker_file(tmp_path: Path) -> None:
    messages = []
    dirty_file = tmp_path / "dirty"
    dirty_file.write_text("1\n")

    session = NativeSession(messages.append)
    session._dirty_status_path = dirty_file  # noqa: SLF001

    session._write_dirty_status()  # noqa: SLF001

    assert messages == [{"type": "dirtyStatus", "dirty": True, "buffers": []}]


def test_dirty_status_uses_tracker_file_without_rpc(tmp_path: Path) -> None:
    messages = []
    dirty_file = tmp_path / "dirty"
    dirty_file.write_text("1\n")

    class FailingRpc:
        class funcs:
            @staticmethod
            def getbufinfo(query):
                raise AssertionError("dirty status must not call Neovim RPC")

    session = NativeSession(messages.append)
    session._rpc = FailingRpc()  # noqa: SLF001
    session._dirty_status_path = dirty_file  # noqa: SLF001

    session._write_dirty_status()  # noqa: SLF001

    assert messages == [{"type": "dirtyStatus", "dirty": True, "buffers": []}]


def test_pty_dirty_control_message_emits_status_once() -> None:
    messages = []
    session = NativeSession(messages.append)

    assert session._handle_pty_controls(b"\x1b]777;NvimViewDirty=1\x07") == b""  # noqa: SLF001
    assert session._handle_pty_controls(b"\x1b]777;NvimViewDirty=1\x07") == b""  # noqa: SLF001

    assert messages == [{"type": "dirtyStatus", "dirty": True, "buffers": []}]


def test_pty_dirty_control_message_handles_split_frames() -> None:
    messages = []
    session = NativeSession(messages.append)

    assert session._handle_pty_controls(b"abc\x1b]777;NvimViewDirty=") == b"abc"  # noqa: SLF001
    assert session._handle_pty_controls(b"0\x07rest") == b"rest"  # noqa: SLF001

    assert messages == [{"type": "dirtyStatus", "dirty": False, "buffers": []}]


def test_pty_theme_control_message_updates_theme_and_strips_output() -> None:
    messages = []
    session = NativeSession(messages.append)

    filtered = session._handle_pty_controls(  # noqa: SLF001
        b"before\x1b]777;NvimViewTheme=#3c3836,#f2e5bc\x07after"
    )

    assert filtered == b"beforeafter"
    assert messages == [
        {
            "type": "terminalTheme",
            "theme": {"cursor": "#3c3836", "cursorAccent": "#f2e5bc"},
        }
    ]


def test_pty_session_ready_control_message_sets_event() -> None:
    session = NativeSession([].append)

    assert session._session_script_ready.is_set() is False  # noqa: SLF001
    assert session._handle_pty_controls(b"\x1b]777;NvimViewSessionReady=1\x07") == b""  # noqa: SLF001

    assert session._session_script_ready.is_set() is True  # noqa: SLF001


def test_session_script_installs_event_driven_dirty_and_theme_hooks(
    tmp_path: Path,
) -> None:
    session = NativeSession([].append)
    session._dirty_status_path = tmp_path / "dirty"  # noqa: SLF001
    session._session_script_path = tmp_path / "session.vim"  # noqa: SLF001

    session._write_session_script(tmp_path / "file.md")  # noqa: SLF001

    script = (tmp_path / "session.vim").read_text()
    assert "NvimViewDirty=" in script
    assert "NvimViewTheme=" in script
    assert "NvimViewSessionReady=1" in script
    assert "function! NvimViewFocusTargetFile() abort" in script
    assert "function! NvimViewNotifyReady() abort" in script
    assert "function! s:CanonicalPath(path) abort" in script
    assert "fnamemodify(resolve(a:path), ':p')" in script
    assert "autocmd VimEnter,ColorScheme * call <SID>SyncTerminalCursor()" in script
    assert "]12;" in script
    assert "set mouse=" in script
    assert (tmp_path / "dirty").read_text() == "0\n"


def test_session_script_can_preserve_neovim_mouse_mode(tmp_path: Path) -> None:
    session = NativeSession([].append)
    session._dirty_status_path = tmp_path / "dirty"  # noqa: SLF001
    session._session_script_path = tmp_path / "session.vim"  # noqa: SLF001

    session._write_session_script(  # noqa: SLF001
        tmp_path / "file.md",
        mouse_mode="neovim",
    )

    assert "set mouse=" not in (tmp_path / "session.vim").read_text()


def test_close_terminates_the_neovim_process_group(monkeypatch) -> None:
    signals = []

    class FakeProcess:
        pid = 1234

        def __init__(self):
            self.polls = 0

        def poll(self):
            self.polls += 1
            return None

        def wait(self, timeout):
            raise TimeoutError("still running")

        def kill(self):
            raise AssertionError("close should terminate the process group")

        def terminate(self):
            raise AssertionError("close should terminate the process group")

    def fake_killpg(pid, sig):
        signals.append((pid, sig))

    monkeypatch.setattr("native_host.session.descendant_pids", lambda pid: [])
    monkeypatch.setattr("native_host.session.os.getpgid", lambda pid: pid)
    monkeypatch.setattr("native_host.session.os.killpg", fake_killpg)
    monkeypatch.setattr("native_host.session.time.sleep", lambda delay: None)
    monotonic_values = iter([0, 0.3])
    monkeypatch.setattr(
        "native_host.session.time.monotonic",
        lambda: next(monotonic_values, 0.3),
    )

    session = NativeSession([].append)
    session._process = FakeProcess()  # noqa: SLF001

    session.close()

    assert signals == [(1234, signal.SIGTERM), (1234, signal.SIGKILL)]


def test_signal_process_tree_targets_descendant_process_groups(monkeypatch) -> None:
    signals = []
    pgids = {
        1000: 1000,
        1001: 1001,
        1002: 1001,
    }

    monkeypatch.setattr(
        "native_host.session.descendant_pids",
        lambda root_pid: [1001, 1002],
    )
    monkeypatch.setattr("native_host.session.os.getpgid", lambda pid: pgids[pid])
    monkeypatch.setattr(
        "native_host.session.os.killpg",
        lambda pgid, sig: signals.append((pgid, sig)),
    )

    signal_process_tree(1000, signal.SIGTERM)

    assert set(signals) == {(1000, signal.SIGTERM), (1001, signal.SIGTERM)}


def test_terminate_nvim_processes_for_rpc_dir_reports_matches(
    monkeypatch,
    tmp_path: Path,
) -> None:
    signals = []
    calls = 0

    def fake_matches(rpc_dir):
        nonlocal calls
        calls += 1
        return [1000] if calls == 1 else []

    monkeypatch.setattr("native_host.session.nvim_pids_for_rpc_dir", fake_matches)
    monkeypatch.setattr(
        "native_host.session.signal_nvim_processes_for_rpc_dir",
        lambda rpc_dir, sig: signals.append((rpc_dir, sig)),
    )

    rpc_dir = tmp_path / "nvimview-rpc-test"
    assert terminate_nvim_processes_for_rpc_dir(rpc_dir)
    assert signals == [(rpc_dir, signal.SIGTERM)]


def test_terminate_nvim_processes_for_rpc_dir_skips_empty_matches(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        "native_host.session.nvim_pids_for_rpc_dir",
        lambda rpc_dir: [],
    )
    monkeypatch.setattr(
        "native_host.session.signal_nvim_processes_for_rpc_dir",
        lambda rpc_dir, sig: (_ for _ in ()).throw(AssertionError("must not signal")),
    )

    assert not terminate_nvim_processes_for_rpc_dir(tmp_path / "nvimview-rpc-test")


def test_close_cleans_resources_without_running_process(tmp_path: Path) -> None:
    cleaned = []
    rpc_dir = tmp_path / "rpc"
    rpc_dir.mkdir()

    class FakeSnapshot:
        def cleanup(self):
            cleaned.append("snapshot")

    class FakeRpc:
        def close(self):
            cleaned.append("rpc")

    session = NativeSession([].append)
    session._temp_snapshot = FakeSnapshot()  # noqa: SLF001
    session._rpc = FakeRpc()  # noqa: SLF001
    session._rpc_dir = rpc_dir  # noqa: SLF001

    session.close()

    assert cleaned == ["rpc", "snapshot"]
    assert not rpc_dir.exists()


def test_close_closes_pty_before_process_group_signals(monkeypatch) -> None:
    calls = []

    class FakeProcess:
        pid = 1234
        closed = False

        def poll(self):
            return 0 if self.closed else None

    process = FakeProcess()

    def fake_close(fd):
        calls.append(("close", fd))
        process.closed = True

    def fake_killpg(pid, sig):
        calls.append(("killpg", pid, sig))

    monkeypatch.setattr("native_host.session.os.write", lambda fd, data: None)
    monkeypatch.setattr("native_host.session.os.close", fake_close)
    monkeypatch.setattr("native_host.session.os.killpg", fake_killpg)

    session = NativeSession([].append)
    session._process = process  # noqa: SLF001
    session._pty_fd = 3  # noqa: SLF001

    session.close()

    assert calls == [("close", 3)]


def test_resize_reaches_neovim_without_extension_pane_commands(monkeypatch) -> None:
    calls = []

    class FakeProcess:
        pid = 1234

        def poll(self):
            return None

    monkeypatch.setattr(
        "native_host.session.set_pty_size",
        lambda fd, cols, rows: calls.append(("resize", fd, cols, rows)),
    )
    monkeypatch.setattr(
        "native_host.session.os.killpg",
        lambda pid, sig: calls.append(("sigwinch", pid, sig)),
    )

    session = NativeSession([].append)
    session._process = FakeProcess()  # noqa: SLF001
    session._pty_fd = 3  # noqa: SLF001

    session._resize(150, 32)  # noqa: SLF001

    assert calls == [("resize", 3, 150, 32), ("sigwinch", 1234, signal.SIGWINCH)]


def test_cursor_theme_uses_reversed_cursor_highlight() -> None:
    theme = cursor_theme_from_highlights(
        {
            "cursor_reverse": "1",
            "normal_fg": "#3c3836",
            "normal_bg": "#f2e5bc",
        }
    )

    assert theme == {"cursor": "#3c3836", "cursorAccent": "#f2e5bc"}


def test_cursor_theme_uses_explicit_cursor_highlight() -> None:
    theme = cursor_theme_from_highlights(
        {
            "cursor_bg": "#111111",
            "cursor_fg": "#eeeeee",
            "normal_fg": "#222222",
            "normal_bg": "#dddddd",
        }
    )

    assert theme == {"cursor": "#111111", "cursorAccent": "#eeeeee"}
