"""Database connection helpers.

Reads ``DATABASE_URL`` from the environment. For local development, a
``worker/.env`` file is loaded first (real secrets never live in git).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import psycopg
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parents[2]


def database_url() -> str:
    """Return the Postgres connection string, or raise with guidance."""
    load_dotenv(_WORKER_ROOT / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy worker/.env.example to worker/.env "
            "and fill in the Neon connection string."
        )
    return url


def connect() -> psycopg.Connection[Any]:
    """Open a new database connection (caller is responsible for closing)."""
    return psycopg.connect(database_url())
