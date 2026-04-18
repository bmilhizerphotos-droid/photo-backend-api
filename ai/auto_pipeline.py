import os
import sqlite3
import subprocess
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "photo-db.sqlite")

# Use the current venv interpreter (ai-env) automatically
PYTHON = sys.executable

# Slow-backfill settings:
BATCH_SIZE = 100  # process at most 100 new photos per run


def run_cmd(cmd: str, cwd: str) -> None:
    print(f"\n> {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=cwd)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {result.returncode}: {cmd}")


def fetch_unprocessed_photo_ids(limit: int) -> list[int]:
    """
    Unprocessed = photos without ANY photo_tags row where added_by = 'ai'
    Deterministic ordering by id ascending.
    """
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute(
        """
        SELECT p.id
        FROM photos p
        WHERE NOT EXISTS (
            SELECT 1
            FROM photo_tags pt
            WHERE pt.photo_id = p.id
              AND pt.added_by = 'ai'
        )
        ORDER BY p.id ASC
        LIMIT ?
        """,
        (limit,),
    )

    ids = [int(r[0]) for r in cur.fetchall()]
    conn.close()
    return ids


def main() -> None:
    print("Auto pipeline starting...")
    print(f"DB: {DB_PATH}")

    if not os.path.exists(DB_PATH):
        print("ERROR: Database file not found:", DB_PATH)
        sys.exit(1)

    ids = fetch_unprocessed_photo_ids(BATCH_SIZE)
    if not ids:
        print("No new photos to process. Exiting.")
        return

    print(f"Found {len(ids)} unprocessed photos. Processing this run only (slow backfill).")

    ids_arg = ",".join(str(i) for i in ids)

    # 1) Tag only these IDs
    run_cmd(f'"{PYTHON}" ai/tagger.py --ids "{ids_arg}"', cwd=BASE_DIR)

    # 2) Sync tags -> photo_captions.keywords
    run_cmd(f'"{PYTHON}" sync_tags_to_keywords.py', cwd=BASE_DIR)

    # 3) Rebuild FTS so search sees the new keywords
    run_cmd('curl -X POST "http://localhost:3001/api/debug/fts-rebuild"', cwd=BASE_DIR)

    print("\nAuto pipeline finished successfully.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("\nERROR:", str(e))
        sys.exit(1)
