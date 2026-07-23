"""Sync verified production title overrides into the source catalog."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover
    def load_dotenv(*_args: object, **_kwargs: object) -> bool:
        return False


ROOT_DIR = Path(__file__).resolve().parents[1]
TITLE_OVERRIDES_PATH = ROOT_DIR / "web" / "lib" / "paper-title-overrides.json"


def title_rows() -> list[tuple[str, str]]:
    payload = json.loads(TITLE_OVERRIDES_PATH.read_text(encoding="utf-8"))
    return [
        (str(title).strip(), Path(filename).stem)
        for filename, title in sorted(payload.items())
        if str(title).strip()
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync CivilMCP effective titles to civil_source_catalog.")
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = title_rows()
    print(f"Verified titles planned: {len(rows)}")
    if not args.apply:
        print("Dry run complete; pass --apply to update Supabase.")
        return

    load_dotenv(ROOT_DIR / ".env")
    database_url = os.getenv("SUPABASE_DB_URL")
    if not database_url:
        raise RuntimeError("SUPABASE_DB_URL is required for --apply.")

    import psycopg

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.executemany(
                """
                update public.civil_source_catalog
                set title_local = %s,
                    updated_at = now()
                where provider_record_id = %s
                  and provider in ('student_transport_projects', 'ncce')
                """,
                rows,
            )
        connection.commit()
    print(f"Verified titles applied: {len(rows)}")


if __name__ == "__main__":
    main()
