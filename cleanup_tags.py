import sqlite3
import os
import re

DB_PATH = os.path.join(os.path.dirname(__file__), "photo-db.sqlite")

STOP_WORDS = {
    "a", "an", "the",
    "that", "someone", "something",
    "photo", "image", "picture"
}

def normalize_tag(tag):
    tag = tag.lower().strip()

    # Remove leading articles
    tag = re.sub(r'^(a|an|the)\s+', '', tag)

    # Remove weird characters except spaces and letters
    tag = re.sub(r'[^a-z0-9\s-]', '', tag)

    # Collapse multiple spaces
    tag = re.sub(r'\s+', ' ', tag)

    return tag.strip()

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

print("Starting improved cleanup...")

# Load all tags
cursor.execute("SELECT id, name FROM tags")
rows = cursor.fetchall()

deleted = 0
updated = 0

for tag_id, name in rows:
    original = name
    cleaned = normalize_tag(name)

    # Remove very short junk
    if (
        cleaned in STOP_WORDS
        or len(cleaned) < 3
        or cleaned == ""
    ):
        cursor.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        deleted += 1
        continue

    # If normalized changed it, update it
    if cleaned != original:
        cursor.execute(
            "UPDATE tags SET name = ? WHERE id = ?",
            (cleaned, tag_id)
        )
        updated += 1

conn.commit()

print(f"Deleted {deleted} junk tags.")
print(f"Updated {updated} tags.")
print("Cleanup complete.")

conn.close()
