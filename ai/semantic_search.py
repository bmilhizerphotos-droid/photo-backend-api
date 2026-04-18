#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import sys
from typing import List, Optional

import numpy as np
import torch
from transformers import CLIPModel, CLIPProcessor

MODEL_NAME = "openai/clip-vit-base-patch32"


def _json_out(payload: dict, exit_code: int):
    print(json.dumps(payload))
    sys.exit(exit_code)


def _l2_normalize_rows(x: np.ndarray) -> np.ndarray:
    denom = np.linalg.norm(x, axis=1, keepdims=True)
    denom[denom == 0] = 1.0
    return x / denom


def _l2_normalize_vec(x: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(x)
    return x if n == 0 else x / n


def _get_text_embedding(model, processor, text: str, device: str) -> np.ndarray:
    inputs = processor(
        text=[text],
        return_tensors="pt",
        padding=True,
        truncation=True
    )

    inputs = {k: v.to(device) for k, v in inputs.items() if k in ("input_ids", "attention_mask")}

    with torch.no_grad():
        text_outputs = model.text_model(
            input_ids=inputs["input_ids"],
            attention_mask=inputs.get("attention_mask"),
            return_dict=True
        )

        pooled = text_outputs.pooler_output
        text_features = model.text_projection(pooled)
        text_features = torch.nn.functional.normalize(text_features, dim=-1)

    return text_features[0].cpu().numpy().astype(np.float32)


def semantic_search(
    db_path: str,
    query: str,
    limit: int,
    offset: int,
    exclude_ids: Optional[List[int]],
    max_scan: int
):
    if not os.path.exists(db_path):
        return {"ok": False, "error": f"DB not found: {db_path}"}

    device = "cuda" if torch.cuda.is_available() else "cpu"

    model = CLIPModel.from_pretrained(MODEL_NAME)
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model.eval().to(device)

    q_emb = _get_text_embedding(model, processor, query, device)
    q_emb = _l2_normalize_vec(q_emb)

    conn = sqlite3.connect(db_path)

    try:
        sql = "SELECT photo_id, embedding FROM photo_image_embeddings"
        params = []

        if exclude_ids:
            placeholders = ",".join(["?"] * len(exclude_ids))
            sql += f" WHERE photo_id NOT IN ({placeholders})"
            params.extend(exclude_ids)

        if max_scan > 0:
            sql += " LIMIT ?"
            params.append(max_scan)

        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()

    if not rows:
        return {
            "ok": True,
            "mode": "semantic",
            "query": query,
            "count": 0,
            "results": [],
            "device": device
        }

    photo_ids = []
    embeddings = []

    for pid, blob in rows:
        emb = np.frombuffer(blob, dtype=np.float32)
        if emb.shape[0] != q_emb.shape[0]:
            continue
        photo_ids.append(pid)
        embeddings.append(emb)

    if not embeddings:
        return {
            "ok": True,
            "mode": "semantic",
            "query": query,
            "count": 0,
            "results": [],
            "device": device
        }

    E = np.vstack(embeddings)
    E = _l2_normalize_rows(E)

    scores = E @ q_emb

    order = np.argsort(-scores)

    sel = order[offset:offset + limit]

    results = [
        {"photo_id": int(photo_ids[i]), "score": float(scores[i])}
        for i in sel
    ]

    return {
        "ok": True,
        "mode": "semantic",
        "query": query,
        "count": len(results),
        "results": results,
        "device": device,
        "scanned": len(rows)
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--q", required=True)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--exclude", default="")
    parser.add_argument("--max-scan", type=int, default=0)

    args = parser.parse_args()

    exclude_ids = [int(x) for x in args.exclude.split(",") if x.strip()]

    try:
        out = semantic_search(
            db_path=args.db,
            query=args.q,
            limit=args.limit,
            offset=args.offset,
            exclude_ids=exclude_ids,
            max_scan=args.max_scan
        )
        _json_out(out, 0 if out.get("ok") else 1)
    except Exception as e:
        _json_out({"ok": False, "error": str(e)}, 1)


if __name__ == "__main__":
    main()
