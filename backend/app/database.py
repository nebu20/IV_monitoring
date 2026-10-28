"""Async SQLAlchemy engine, session factory, and Base declarative model."""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    """FastAPI dependency that yields an async database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_tables():
    """Create all tables on startup (idempotent)."""
    async with engine.begin() as conn:
        from app import models  # noqa: F401 – ensure models are registered
        await conn.run_sync(Base.metadata.create_all)


async def run_column_migrations() -> None:
    """
    Add columns introduced after the initial schema was created.
    Uses ALTER TABLE … ADD COLUMN IF NOT EXISTS so this is safe to run
    on every startup against both fresh and existing databases.

    PostgreSQL syntax is used for the live database.
    SQLite (test environment) does not support IF NOT EXISTS on
    ALTER TABLE in older versions; the function catches and silently
    ignores the error that occurs when the column already exists.
    """
    from sqlalchemy import text

    migrations = [
        # token_version: integer, default 1, not null
        (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
            "token_version INTEGER NOT NULL DEFAULT 1",
            # SQLite fallback (no IF NOT EXISTS):
            "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1",
        ),
        # must_change_password: boolean, default false, not null
        (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
            "must_change_password BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false",
        ),
        # deactivated_by: string, nullable
        (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
            "deactivated_by VARCHAR(64)",
            "ALTER TABLE users ADD COLUMN deactivated_by VARCHAR(64)",
        ),
        # deactivated_at: datetime, nullable
        (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
            "deactivated_at TIMESTAMP",
            "ALTER TABLE users ADD COLUMN deactivated_at TIMESTAMP",
        ),
        # deactivation_reason: text, nullable
        (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
            "deactivation_reason TEXT",
            "ALTER TABLE users ADD COLUMN deactivation_reason TEXT",
        ),
        # ── DoseRecord unique constraint (medication Phase 1 fix) ─────────────
        # PostgreSQL: add unique index if not exists
        # SQLite: the constraint is already created by create_all for new DBs;
        #         for existing test DBs (in-memory) create_all handles it.
        (
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_dose_schedule_datetime "
            "ON dose_records (schedule_id, scheduled_datetime)",
            # SQLite: same syntax, silently ignored if already exists
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_dose_schedule_datetime "
            "ON dose_records (schedule_id, scheduled_datetime)",
        ),
    ]

    async with engine.begin() as conn:
        # Detect dialect
        dialect = engine.dialect.name  # "postgresql" | "sqlite" | etc.

        for pg_sql, sqlite_sql in migrations:
            sql = pg_sql if dialect == "postgresql" else sqlite_sql
            try:
                await conn.execute(text(sql))
            except Exception:
                # Column already exists — safe to ignore
                pass
