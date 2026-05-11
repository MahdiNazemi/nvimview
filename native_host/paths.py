from __future__ import annotations

import shutil
import tempfile
import time
from dataclasses import dataclass
from os import O_CREAT, O_EXCL, O_WRONLY, close, fdopen
from os import open as os_open
from pathlib import Path
from urllib.parse import unquote, urlparse

SNAPSHOT_PREFIX = "nvimview-"
DEFAULT_PROJECT_ROOT_MARKERS = (
    {"path": ".git", "strategy": "highest"},
    {"path": "AGENTS.md", "strategy": "highest"},
    {"path": "CLAUDE.md", "strategy": "highest"},
    {"path": ".claude", "strategy": "highest"},
)


@dataclass(frozen=True)
class TempSnapshot:
    path: Path
    directory: Path
    nvim_filetype: str

    def cleanup(self) -> None:
        shutil.rmtree(self.directory, ignore_errors=True)


def decode_file_url(url: str) -> Path:
    parsed = urlparse(url)
    if parsed.scheme != "file":
        raise ValueError("expected file URL")
    if parsed.netloc not in ("", "localhost"):
        raise ValueError("remote file URL hosts are not supported")
    return Path(unquote(parsed.path)).resolve()


def find_git_root(start: Path) -> Path | None:
    current = start if start.is_dir() else start.parent
    for directory in (current, *current.parents):
        if (directory / ".git").exists():
            return directory
    return None


def _normal_marker_path(value: object) -> str:
    marker = str(value or "").strip().rstrip("/")
    path = Path(marker)
    if (
        not marker
        or path.is_absolute()
        or any(part in ("", ".", "..") for part in path.parts)
    ):
        raise ValueError(f"invalid project root marker: {marker!r}")
    return marker


def normalize_project_root_markers(markers: object = None) -> list[dict[str, str]]:
    if markers is None:
        markers = DEFAULT_PROJECT_ROOT_MARKERS
    if not isinstance(markers, list | tuple):
        return list(DEFAULT_PROJECT_ROOT_MARKERS)

    normalized = []
    for marker in markers:
        if isinstance(marker, str):
            path = _normal_marker_path(marker)
            strategy = "highest"
        elif isinstance(marker, dict):
            path = _normal_marker_path(marker.get("path"))
            strategy = str(marker.get("strategy", "highest")).strip().lower()
        else:
            raise ValueError(f"invalid project root marker: {marker!r}")
        if strategy not in ("highest", "nearest"):
            raise ValueError(f"invalid project root marker strategy: {strategy!r}")
        normalized.append({"path": path, "strategy": strategy})
    return normalized or list(DEFAULT_PROJECT_ROOT_MARKERS)


def find_project_root(start: Path, markers: object = None) -> Path | None:
    current = start if start.is_dir() else start.parent
    home = Path.home().resolve()
    directories = []
    for directory in (current, *current.parents):
        try:
            resolved = directory.resolve()
        except OSError:
            resolved = directory
        if resolved == home:
            break
        directories.append(directory)
    for marker in normalize_project_root_markers(markers):
        matches = [
            directory
            for directory in directories
            if (directory / marker["path"]).exists()
        ]
        if not matches:
            continue
        return matches[-1] if marker["strategy"] == "highest" else matches[0]
    return None


def _safe_name(name: str) -> str:
    candidate = Path(name).name
    if candidate in ("", ".", ".."):
        return "snapshot.txt"
    return candidate


def safe_temp_snapshot(
    *,
    content: bytes,
    suggested_name: str,
    nvim_filetype: str,
) -> TempSnapshot:
    directory = Path(tempfile.mkdtemp(prefix=SNAPSHOT_PREFIX))
    path = directory / _safe_name(suggested_name)
    fd = os_open(path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
    try:
        with fdopen(fd, "wb") as handle:
            fd = -1
            handle.write(content)
    finally:
        if fd >= 0:
            close(fd)
    return TempSnapshot(path=path, directory=directory, nvim_filetype=nvim_filetype)


def cleanup_old_snapshots(
    parent: Path | None = None,
    *,
    max_age_seconds: float = 0,
) -> None:
    root = parent or Path(tempfile.gettempdir())
    cutoff = time.time() - max_age_seconds
    for candidate in root.glob(f"{SNAPSHOT_PREFIX}*"):
        try:
            is_old_directory = (
                candidate.is_dir() and candidate.stat().st_mtime <= cutoff
            )
        except OSError:
            continue
        if is_old_directory:
            shutil.rmtree(candidate, ignore_errors=True)
