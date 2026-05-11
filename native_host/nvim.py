from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

MIN_NVIM_VERSION = (0, 10, 0)
NVIM_FILETYPE_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")


def parse_nvim_version(output: str) -> tuple[int, int, int]:
    match = re.search(r"NVIM v(\d+)\.(\d+)\.(\d+)", output)
    if not match:
        raise ValueError("could not parse Neovim version")
    return tuple(int(part) for part in match.groups())


def resolve_nvim_executable(explicit: str = "") -> str:
    if explicit:
        return explicit
    found = shutil.which("nvim")
    if found:
        return found
    for candidate in (
        "/opt/homebrew/bin/nvim",
        "/usr/local/bin/nvim",
        "/usr/bin/nvim",
    ):
        if Path(candidate).exists():
            return candidate
    raise FileNotFoundError("nvim executable not found")


def validate_nvim(executable: str) -> tuple[int, int, int]:
    result = subprocess.run(
        [executable, "--version"],
        capture_output=True,
        check=True,
        text=True,
        timeout=5,
    )
    version = parse_nvim_version(result.stdout)
    if version < MIN_NVIM_VERSION:
        raise RuntimeError(f"Neovim {version!r} is older than {MIN_NVIM_VERSION!r}")
    return version


def diagnose_nvim(explicit: str = "") -> dict[str, object]:
    try:
        executable = resolve_nvim_executable(explicit)
        version = validate_nvim(executable)
    except Exception as error:  # noqa: BLE001
        return {
            "ok": False,
            "error": str(error),
        }
    return {
        "ok": True,
        "executable": executable,
        "version": ".".join(str(part) for part in version),
    }


def _vim_command(command: str) -> list[str]:
    return ["-c", command]


def validate_nvim_filetype(filetype: str) -> str:
    if not filetype:
        return ""
    if not NVIM_FILETYPE_PATTERN.fullmatch(filetype):
        raise ValueError(f"invalid Neovim filetype: {filetype!r}")
    return filetype


def vim_fnameescape(path: str) -> str:
    escaped = path.replace("\\", "\\\\")
    for char in (
        " ",
        "\t",
        "\n",
        "*",
        "[",
        "]",
        "{",
        "}",
        "?",
        "$",
        "%",
        "#",
        "'",
        '"',
        "`",
        "!",
        "<",
        ">",
        "|",
    ):
        escaped = escaped.replace(char, f"\\{char}")
    return escaped


def build_nvim_args(
    *,
    executable: str,
    file_path: str,
    read_only: bool,
    nvim_filetype: str,
    listen_address: str,
    startup_command: str,
    session_script_path: str = "",
) -> list[str]:
    args = [executable]
    if listen_address:
        args.extend(["--listen", listen_address])
    if read_only:
        args.append("-R")
    nvim_filetype = validate_nvim_filetype(nvim_filetype)
    if nvim_filetype:
        args.extend(_vim_command(f"setlocal filetype={nvim_filetype}"))
    if session_script_path:
        args.extend(_vim_command(f"source {vim_fnameescape(session_script_path)}"))
    if startup_command:
        args.extend(_vim_command(startup_command))
        if session_script_path:
            args.extend(_vim_command("silent! call NvimViewFocusTargetFile()"))
    if session_script_path:
        args.extend(_vim_command("silent! call NvimViewNotifyReady()"))
    args.append(file_path)
    return args
