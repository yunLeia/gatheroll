"""Real Alembic 0003→0004 in a disposable schema of the dedicated test DB only."""

import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def test_migration_preserves_legacy_events_and_linked_private_photos() -> None:
    url = make_url(os.environ["TEST_DATABASE_URL"])
    assert url.database and "test" in url.database
    schema = "migration_" + uuid4().hex
    engine = create_engine(url)
    api_dir = Path(__file__).resolve().parents[1]
    scoped = url.update_query_dict({"options": f"-csearch_path={schema}"})
    env = {**os.environ, "DATABASE_URL": scoped.render_as_string(hide_password=False)}

    def migrate(target: str) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", target],
            cwd=api_dir,
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, "Scoped Alembic migration failed"

    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        migrate("0003")
        scoped_engine = create_engine(scoped)
        with scoped_engine.begin() as connection:
            connection.execute(
                text("""
                INSERT INTO events (id,title,starts_at,ends_at,share_token,
                    created_at,expires_at,manage_token_hash)
                VALUES ('00000000-0000-0000-0000-000000000001','Legacy',
                    '2020-01-01T00:00:00Z','2020-01-02T00:00:00Z',
                    'synthetic-share','2020-01-01T00:00:00Z',
                    '2020-02-01T00:00:00Z','synthetic-hash')
            """)
            )
            connection.execute(
                text("""
                INSERT INTO participants (id,event_id,display_name,status,
                    participant_token_hash,joined_at,approved_at)
                VALUES ('00000000-0000-0000-0000-000000000002',
                    '00000000-0000-0000-0000-000000000001','Synthetic','approved',
                    'synthetic-participant','2020-01-01T00:00:00Z',
                    '2020-01-01T00:00:00Z')
            """)
            )
            connection.execute(
                text("""
                INSERT INTO photos (id,event_id,participant_id,client_id,status,
                    original_key,original_filename,content_type,file_size_bytes,
                    created_at,uploaded_at)
                VALUES ('00000000-0000-0000-0000-000000000003',
                    '00000000-0000-0000-0000-000000000001',
                    '00000000-0000-0000-0000-000000000002',
                    '00000000-0000-0000-0000-000000000004','uploaded_private',
                    'synthetic/no-real-object','synthetic.jpg','image/jpeg',1,
                    '2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')
            """)
            )
            before = {
                table: connection.execute(
                    text(f"SELECT row_to_json(t) FROM {table} t")
                ).scalar_one()
                for table in ("events", "participants", "photos")
            }
        migrate("0004")
        with scoped_engine.begin() as connection:
            after = {
                table: connection.execute(
                    text(f"SELECT row_to_json(t) FROM {table} t")
                ).scalar_one()
                for table in before
            }
            assert after["events"].pop("event_date") is None
            assert before == after
            connection.execute(
                text("""
                INSERT INTO events (id,title,share_token,created_at,
                    expires_at,event_date)
                VALUES ('00000000-0000-0000-0000-000000000005','No boundaries',
                    'new-share','2026-09-07T00:00:00Z','2026-10-07T00:00:00Z',
                    '2026-09-07')
            """)
            )
            assert connection.execute(
                text(
                    "SELECT starts_at IS NULL AND ends_at IS NULL FROM events "
                    "WHERE share_token='new-share'"
                )
            ).scalar_one()
        scoped_engine.dispose()
    finally:
        # Only this test's random schema, never existing app/test tables.
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()
