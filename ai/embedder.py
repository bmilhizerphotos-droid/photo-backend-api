import argparse
import sqlite3
import os
import torch
import numpy as np
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
from tqdm import tqdm

DB_PATH = "photo-db.sqlite"
MODEL_NAME = "openai/clip-vit-base-patch32"

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")

model = CLIPModel.from_pretrained(MODEL_NAME)
processor = CLIPProcessor.from_pretrained(MODEL_NAME)
model = model.to(device)
model.eval()


def get_connection():
    return sqlite3.connect(DB_PATH)


def get_photos(limit, offset):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, full_path
        FROM photos
        WHERE full_path IS NOT NULL
          AND id NOT IN (SELECT photo_id FROM photo_image_embeddings)
        LIMIT ? OFFSET ?
    """, (limit, offset))

    rows = cursor.fetchall()
    conn.close()
    return rows


def generate_embedding(image_path):
    image = Image.open(image_path).convert("RGB")

    inputs = processor(images=image, return_tensors="pt")
    pixel_values = inputs["pixel_values"].to(device)

    with torch.no_grad():
        vision_outputs = model.vision_model(pixel_values=pixel_values)
        pooled = vision_outputs.pooler_output
        image_features = model.visual_projection(pooled)

    image_features = image_features / image_features.norm(dim=-1, keepdim=True)
    return image_features.cpu().numpy()[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--commit-every", type=int, default=200)
    args = parser.parse_args()

    photos = get_photos(args.limit, args.offset)

    if not photos:
        print("No photos to embed.")
        return

    print(f"Processing {len(photos)} images...")

    conn = get_connection()
    cursor = conn.cursor()

    processed = 0
    batch_counter = 0

    for photo_id, path in tqdm(photos):

        try:
            if not os.path.exists(path):
                continue

            embedding = generate_embedding(path)

            cursor.execute("""
                INSERT OR REPLACE INTO photo_image_embeddings (photo_id, embedding, model)
                VALUES (?, ?, ?)
            """, (
                photo_id,
                embedding.astype(np.float32).tobytes(),
                MODEL_NAME
            ))

            processed += 1
            batch_counter += 1

            if batch_counter >= args.commit_every:
                conn.commit()
                batch_counter = 0

        except Exception as e:
            print(f"\nError processing {photo_id}: {e}")

    conn.commit()
    conn.close()

    print(f"\nEmbedding batch complete. Inserted {processed} embeddings.")


if __name__ == "__main__":
    main()
