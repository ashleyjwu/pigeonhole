from __future__ import annotations

import os
from collections.abc import Sequence
from pathlib import Path

import pytest

from pigeonhole_worker.migrate import (
    MIGRATIONS_DIR,
    Migration,
    apply_migrations,
    discover_migrations,
    pending_migrations,
)


class FakeCursor:
    def __init__(self, rows: list[tuple[int, ...]]) -> None:
        self._rows = rows

    def fetchall(self) -> list[tuple[int, ...]]:
        return self._rows


class FakeConn:
    """In-memory stand-in satisfying the DBConnection protocol."""

    def __init__(self, fail_on: str | None = None) -> None:
        self.applied_versions: list[int] = []
        self.committed_versions: list[int] = []
        self.executed: list[str] = []
        self.rollbacks = 0
        self._fail_on = fail_on
        self._pending_version: int | None = None

    def execute(self, query: str, params: Sequence[object] | None = None) -> FakeCursor:
        if self._fail_on is not None and self._fail_on in query:
            raise RuntimeError(f"boom: {self._fail_on}")
        self.executed.append(query)
        if query.startswith("SELECT version"):
            return FakeCursor([(v,) for v in self.committed_versions])
        if query.startswith("INSERT INTO schema_migrations"):
            assert params is not None
            version = params[0]
            assert isinstance(version, int)
            self._pending_version = version
        return FakeCursor([])

    def commit(self) -> None:
        if self._pending_version is not None:
            self.committed_versions.append(self._pending_version)
            self._pending_version = None

    def rollback(self) -> None:
        self._pending_version = None
        self.rollbacks += 1


def _write(directory: Path, name: str, sql: str = "CREATE TABLE t (id int);") -> None:
    (directory / name).write_text(sql, encoding="utf-8")


# ── discovery ────────────────────────────────────────────────────────────────


def test_discovery_sorts_by_version(tmp_path: Path) -> None:
    _write(tmp_path, "0002_second.sql")
    _write(tmp_path, "0001_first.sql")
    versions = [m.version for m in discover_migrations(tmp_path)]
    assert versions == [1, 2]


def test_discovery_rejects_bad_filename(tmp_path: Path) -> None:
    _write(tmp_path, "init.sql")
    with pytest.raises(ValueError, match="must look like"):
        discover_migrations(tmp_path)


def test_discovery_rejects_duplicate_versions(tmp_path: Path) -> None:
    _write(tmp_path, "0001_a.sql")
    _write(tmp_path, "0001_b.sql")
    with pytest.raises(ValueError, match="Duplicate migration version"):
        discover_migrations(tmp_path)


def test_discovery_rejects_empty_file(tmp_path: Path) -> None:
    _write(tmp_path, "0001_empty.sql", sql="   \n")
    with pytest.raises(ValueError, match="is empty"):
        discover_migrations(tmp_path)


def test_repo_migrations_are_valid() -> None:
    """The real migration files must always be discoverable and well-formed."""
    migrations = discover_migrations(MIGRATIONS_DIR)
    versions = [m.version for m in migrations]
    # Versions are contiguous starting at 1 (no gaps/dupes).
    assert versions == list(range(1, len(migrations) + 1))
    by_version = {m.version: m for m in migrations}
    assert by_version[1].name == "init"
    assert "CREATE EXTENSION IF NOT EXISTS vector" in by_version[1].sql
    assert by_version[2].name == "profiles"


# ── application ──────────────────────────────────────────────────────────────


def _two_migrations() -> list[Migration]:
    return [
        Migration(version=1, name="first", sql="CREATE TABLE a (id int);"),
        Migration(version=2, name="second", sql="CREATE TABLE b (id int);"),
    ]


def test_apply_runs_all_pending() -> None:
    conn = FakeConn()
    applied = apply_migrations(conn, _two_migrations())
    assert [m.version for m in applied] == [1, 2]
    assert conn.committed_versions == [1, 2]
    assert any("CREATE TABLE a" in q for q in conn.executed)
    assert any("CREATE TABLE b" in q for q in conn.executed)


def test_apply_is_idempotent() -> None:
    conn = FakeConn()
    apply_migrations(conn, _two_migrations())
    second_run = apply_migrations(conn, _two_migrations())
    assert second_run == []
    assert conn.committed_versions == [1, 2]  # unchanged


def test_apply_partial_then_resume() -> None:
    migrations = _two_migrations()
    conn = FakeConn()
    apply_migrations(conn, migrations[:1])  # only migration 1 exists at first
    applied = apply_migrations(conn, migrations)  # later, migration 2 appears
    assert [m.version for m in applied] == [2]
    assert conn.committed_versions == [1, 2]


def test_apply_rolls_back_and_raises_on_failure() -> None:
    conn = FakeConn(fail_on="CREATE TABLE b")
    with pytest.raises(RuntimeError, match="boom"):
        apply_migrations(conn, _two_migrations())
    assert conn.committed_versions == [1]  # migration 1 landed, 2 did not
    assert conn.rollbacks == 1


def test_pending_computation() -> None:
    migrations = _two_migrations()
    assert pending_migrations(migrations, set()) == migrations
    assert pending_migrations(migrations, {1}) == migrations[1:]
    assert pending_migrations(migrations, {1, 2}) == []


# ── optional integration (needs a real database) ────────────────────────────


@pytest.mark.skipif(
    "TEST_DATABASE_URL" not in os.environ,
    reason="set TEST_DATABASE_URL to run against a real Postgres",
)
def test_apply_against_real_database() -> None:
    import psycopg

    conn = psycopg.connect(os.environ["TEST_DATABASE_URL"])
    try:
        applied_first = apply_migrations(conn, discover_migrations(MIGRATIONS_DIR))
        applied_second = apply_migrations(conn, discover_migrations(MIGRATIONS_DIR))
        assert applied_second == []  # second run is a no-op
        rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        assert [r[0] for r in rows] == [1, 2]
        del applied_first
    finally:
        conn.close()
