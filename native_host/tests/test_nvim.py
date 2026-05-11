import pytest

from native_host.nvim import (
    build_nvim_args,
    diagnose_nvim,
    parse_nvim_version,
    validate_nvim_filetype,
)


def test_parse_nvim_version() -> None:
    assert parse_nvim_version("NVIM v0.12.2\nBuild type: Release") == (0, 12, 2)


def test_build_nvim_args_uses_tui_and_file_path() -> None:
    args = build_nvim_args(
        executable="/opt/bin/nvim",
        file_path="/tmp/example.py",
        read_only=True,
        nvim_filetype="python",
        listen_address="/tmp/nvim.sock",
        startup_command="",
        session_script_path="/tmp/session.vim",
    )

    assert args[:3] == ["/opt/bin/nvim", "--listen", "/tmp/nvim.sock"]
    assert "-R" in args
    assert "/tmp/example.py" in args
    assert any("setlocal filetype=python" in arg for arg in args)
    assert any("source /tmp/session.vim" in arg for arg in args)
    assert "silent! call NvimViewNotifyReady()" in args


def test_build_nvim_args_runs_startup_command_then_restores_target_focus() -> None:
    args = build_nvim_args(
        executable="/opt/bin/nvim",
        file_path="/tmp/example.py",
        read_only=False,
        nvim_filetype="python",
        listen_address="/tmp/nvim.sock",
        startup_command="call CustomLeftExplorer()",
        session_script_path="/tmp/session.vim",
    )

    assert args.index("source /tmp/session.vim") < args.index(
        "call CustomLeftExplorer()"
    )
    assert args.index("call CustomLeftExplorer()") < args.index(
        "silent! call NvimViewFocusTargetFile()"
    )
    assert args.index("silent! call NvimViewFocusTargetFile()") < args.index(
        "silent! call NvimViewNotifyReady()"
    )


def test_build_nvim_args_does_not_restore_focus_without_startup_command() -> None:
    args = build_nvim_args(
        executable="/opt/bin/nvim",
        file_path="/tmp/example.py",
        read_only=False,
        nvim_filetype="python",
        listen_address="/tmp/nvim.sock",
        startup_command="",
        session_script_path="/tmp/session.vim",
    )

    assert "silent! call NvimViewFocusTargetFile()" not in args
    assert "silent! call NvimViewNotifyReady()" in args


def test_build_nvim_args_escapes_session_script_path_for_vim_command() -> None:
    args = build_nvim_args(
        executable="/opt/bin/nvim",
        file_path="/tmp/example.py",
        read_only=False,
        nvim_filetype="python",
        listen_address="",
        startup_command="",
        session_script_path="/tmp/a path/with|pipe`bang!/session.vim",
    )

    assert "source /tmp/a\\ path/with\\|pipe\\`bang\\!/session.vim" in args


def test_nvim_filetype_rejects_ex_command_separators() -> None:
    with pytest.raises(ValueError):
        validate_nvim_filetype("python | call system('false')")


def test_diagnose_nvim_reports_resolution_failures() -> None:
    result = diagnose_nvim("/path/that/does/not/exist/nvim")

    assert result["ok"] is False
    assert "error" in result
