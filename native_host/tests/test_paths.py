from pathlib import Path
from stat import S_IMODE

import pytest

from native_host.paths import (
    cleanup_old_snapshots,
    decode_file_url,
    find_git_root,
    find_project_root,
    normalize_project_root_markers,
    safe_temp_snapshot,
)


def test_decode_file_url_rejects_non_file_urls() -> None:
    with pytest.raises(ValueError, match="file URL"):
        decode_file_url("https://example.test/a.py")


def test_decode_file_url_handles_percent_encoding(tmp_path: Path) -> None:
    target = tmp_path / "hello world.md"
    target.write_text("hello")

    assert decode_file_url(target.as_uri()) == target


def test_find_git_root_walks_upward(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    child = root / "a" / "b"
    child.mkdir(parents=True)
    (root / ".git").mkdir()

    assert find_git_root(child) == root


def test_find_project_root_uses_highest_marker(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    nested = root / "docs" / "research" / "html"
    nested.mkdir(parents=True)
    (root / "AGENTS.md").write_text("root\n")
    (nested / "check_render.mjs").write_text("console.log('ok')\n")

    assert find_project_root(nested / "check_render.mjs") == root


def test_find_project_root_uses_highest_claude_marker(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    nested = root / "docs" / "research" / "html"
    nested.mkdir(parents=True)
    (root / "CLAUDE.md").write_text("root\n")

    assert find_project_root(nested / "check_render.mjs") == root


def test_find_project_root_can_use_nearest_marker(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    nested = root / "docs" / "research" / "html"
    nested.mkdir(parents=True)
    (root / "AGENTS.md").write_text("root\n")
    (nested / "AGENTS.md").write_text("nested\n")

    assert (
        find_project_root(
            nested / "check_render.mjs",
            [{"path": "AGENTS.md", "strategy": "nearest"}],
        )
        == nested
    )


def test_find_project_root_does_not_use_home_markers(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    project = home / "scratch" / "src"
    project.mkdir(parents=True)
    (home / ".claude").mkdir()
    target = project / "example.py"
    target.write_text("print('ok')\n")
    monkeypatch.setattr(Path, "home", lambda: home)

    assert find_project_root(target) is None


def test_project_root_markers_reject_absolute_paths() -> None:
    with pytest.raises(ValueError, match="project root marker"):
        normalize_project_root_markers([{"path": "/tmp/.git", "strategy": "highest"}])


def test_project_root_markers_reject_invalid_entries() -> None:
    with pytest.raises(ValueError, match="project root marker"):
        normalize_project_root_markers([123])


def test_project_root_markers_reject_unsupported_strategies() -> None:
    with pytest.raises(ValueError, match="project root marker strategy"):
        normalize_project_root_markers([{"path": ".git", "strategy": "lowest"}])


def test_safe_temp_snapshot_writes_under_owned_directory() -> None:
    snapshot = safe_temp_snapshot(
        content=b"hello",
        suggested_name="../unsafe.md",
        nvim_filetype="markdown",
    )

    try:
        assert snapshot.path.name == "unsafe.md"
        assert snapshot.path.read_text() == "hello"
        assert snapshot.path.parent.name.startswith("nvimview-")
        assert S_IMODE(snapshot.path.stat().st_mode) == 0o600
    finally:
        snapshot.cleanup()


def test_cleanup_old_snapshots_only_removes_owned_prefix(tmp_path: Path) -> None:
    owned = tmp_path / "nvimview-old"
    other = tmp_path / "unrelated-old"
    owned.mkdir()
    other.mkdir()

    cleanup_old_snapshots(tmp_path)

    assert not owned.exists()
    assert other.exists()
