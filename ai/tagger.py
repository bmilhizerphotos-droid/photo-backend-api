import os
import sqlite3
import argparse
import torch
import re
from PIL import Image
from transformers import BlipProcessor, BlipForConditionalGeneration
import spacy

DB_PATH = "photo-db.sqlite"

# Load spaCy
nlp = spacy.load("en_core_web_sm")

STOP_SINGLE = {
    "photo", "image", "someone", "something",
    "thing", "person", "people", "picture"
}

def clean_phrase(text):
    text = text.lower().strip()
    text = re.sub(r"^(a|an|the)\s+", "", text)
    text = re.sub(r"[^a-z\s\-]", "", text)
    return text.strip()

def extract_tags_from_caption(caption):
    doc = nlp(caption)
    tags = set()

    # Single nouns
    for token in doc:
        if token.pos_ in ("NOUN", "PROPN"):
            word = clean_phrase(token.text)
            if len(word) >= 3 and word not in STOP_SINGLE:
                tags.add(word)

    # Adjective + noun pairs
    for chunk in doc.noun_chunks:
        phrase = clean_phrase(chunk.text)
        if len(phrase) < 3:
            continue

        words = phrase.split()
        if len(words) == 2:
            tags.add(phrase)

    return list(tags)

def insert_tag(cursor, name):
    cursor.execute("SELECT id FROM tags WHERE name = ?", (name,))
    row = cursor.fetchone()
    if row:
        return row[0]

    cursor.execute("INSERT INTO tags (name) VALUES (?)", (name,))
    return cursor.lastrowid

def process_batch(limit, offset):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, full_path
        FROM photos
        WHERE id NOT IN (
            SELECT DISTINCT photo_id FROM photo_tags WHERE added_by='ai'
        )
        LIMIT ? OFFSET ?
    """, (limit, offset))

    photos = cursor.fetchall()

    if not photos:
        print("No photos to process.")
        return

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print("Using device:", device)

    processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
    model = BlipForConditionalGeneration.from_pretrained(
        "Salesforce/blip-image-captioning-base"
    ).to(device)

    print(f"Processing {len(photos)} images...")

    for photo_id, path in photos:
        try:
            image = Image.open(path).convert("RGB")
        except Exception:
            continue

        inputs = processor(image, return_tensors="pt").to(device)
        out = model.generate(**inputs)
        caption = processor.decode(out[0], skip_special_tokens=True)

        tags = extract_tags_from_caption(caption)

        for tag in tags:
            tag_id = insert_tag(cursor, tag)
            cursor.execute("""
                INSERT OR IGNORE INTO photo_tags (photo_id, tag_id, added_by)
                VALUES (?, ?, 'ai')
            """, (photo_id, tag_id))

    conn.commit()
    conn.close()
    print("Batch complete.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args()

    process_batch(args.limit, args.offset)
