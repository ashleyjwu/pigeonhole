"""Idempotent SQL migration runner.

Migrations are raw SQL files in ``worker/migrations/`` named
``NNNN_description.sql`` (for example ``0001_init.sql``). Applied versions are
recorded in a ``schema_migrations`` table; re-running is a no-op. Each pending
migration runs in its own transaction: its SQL and the bookkeeping INSERT
commit together, or roll back together.

Usage:
    python -m pigeonhole_worker.migrate --dry-run   # list pending, change nothing
    python -m pigeonhole_worker.migrate             # apply pending migrations
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"

_FILENAME_RE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")

_CREATE_SCHEMA_MIGRATIONS = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     int PRIMARY KEY,
    name        text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
)
"""


class _Cursor(Protocol):
    def fetchall(self) -> list[tuple[int, ...]]: ...


class DBConnection(Protocol):
    """The minimal connection surface the runner needs.

    Structurally satisfied by ``psycopg.Connection`` and by test fakes, so the
    runner is unit-testable without a live database.
    """

    def execute(self, query: str, params: Sequence[object] | None = None) -> _Cursor: ...

    def commit(self) -> None: ...

    def rollback(self) -> None: ...


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str


def discover_migrations(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    """Load migrations from ``directory``, sorted by version.

    Raises ``ValueError`` for malformed filenames, duplicate versions, or
    empty migration files — failing loudly beats silently skipping a schema
    change.
    """
    migrations: list[Migration] = []
    seen: dict[int, str] = {}
    for path in sorted(directory.glob("*.sql")):
        match = _FILENAME_RE.match(path.name)
        if match is None:
            raise ValueError(
                f"Migration filename {path.name!r} must look like '0001_description.sql'"
            )
        version = int(match.group(1))
        if version in seen:
            raise ValueError(
                f"Duplicate migration version {version:04d}: {seen[version]} and {path.name}"
            )
        seen[version] = path.name
        sql = path.read_text(encoding="utf-8").strip()
        if not sql:
            raise ValueError(f"Migration {path.name} is empty")
        migrations.append(Migration(version=version, name=match.group(2), sql=sql))
    migrations.sort(key=lambda m: m.version)
    return migrations


def fetch_applied_versions(conn: DBConnection) -> set[int]:
    """Ensure the bookkeeping table exists and return applied versions."""
    conn.execute(_CREATE_SCHEMA_MIGRATIONS)
    conn.commit()
    rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
    return {row[0] for row in rows}


def pending_migrations(migrations: Sequence[Migration], applied: set[int]) -> list[Migration]:
    return [m for m in migrations if m.version not in applied]


def apply_migrations(conn: DBConnection, migrations: Sequence[Migration]) -> list[Migration]:
    """Apply all pending migrations. Returns the ones that were applied.

    Each migration and its bookkeeping row commit atomically; on failure the
    transaction rolls back and the error propagates (nothing is recorded).
    """
    applied = fetch_applied_versions(conn)
    pending = pending_migrations(migrations, applied)
    for migration in pending:
        try:
            conn.execute(migration.sql)
            conn.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (%s, %s)",
                (migration.version, migration.name),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return pending


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply pigeonhole database migrations.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List pending migrations without applying them.",
    )
    args = parser.parse_args(argv)

    # Imported here so offline unit tests never need psycopg/DATABASE_URL.
    from pigeonhole_worker.db import connect

    migrations = discover_migrations()
    conn = connect()
    try:
        if args.dry_run:
            applied = fetch_applied_versions(conn)
            pending = pending_migrations(migrations, applied)
            if not pending:
                print("Up to date: no pending migrations.")
            for migration in pending:
                print(f"pending: {migration.version:04d}_{migration.name}")
        else:
            applied_now = apply_migrations(conn, migrations)
            if not applied_now:
                print("Up to date: no pending migrations.")
            for migration in applied_now:
                print(f"applied: {migration.version:04d}_{migration.name}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
