import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "photo-db.sqlite")

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

print("Starting tag sync...")

# Get all photo_ids that have tags
cursor.execute("""
SELECT DISTINCT photo_id
FROM photo_tags
""")

photo_ids = [row[0] for row in cursor.fetchall()]

updated_count = 0

for photo_id in photo_ids:
    # Get all tag names for this photo
    cursor.execute("""
        SELECT t.name
        FROM photo_tags pt
        JOIN tags t ON t.id = pt.tag_id
        WHERE pt.photo_id = ?
    """, (photo_id,))

    tags = [row[0] for row in cursor.fetchall()]
    if not tags:
        continue

    tag_string = " ".join(tags)

    # Append to existing keywords (without duplicating)
    cursor.execute("""
        SELECT keywords
        FROM photo_captions
        WHERE photo_id = ?
    """, (photo_id,))

    row = cursor.fetchone()

    if row:
        existing = row[0] or ""
        if tag_string not in existing:
            new_keywords = f"{existing} {tag_string}".strip()
            cursor.execute("""
                UPDATE photo_captions
                SET keywords = ?
                WHERE photo_id = ?
            """, (new_keywords, photo_id))
            updated_count += 1
    else:
        # If no caption row exists, create one
        cursor.execute("""
            INSERT INTO photo_captions (photo_id, caption, keywords)
            VALUES (?, '', ?)
        """, (photo_id, tag_string))
        updated_count += 1

conn.commit()
conn.close()

print(f"Updated {updated_count} photo_captions rows.")
print("Tag sync complete.")
