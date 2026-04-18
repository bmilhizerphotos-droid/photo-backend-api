import os
import sqlite3
import time
import numpy as np
import torch
from fastapi import FastAPI, Query
from pydantic import BaseModel
from transformers import CLIPProcessor, CLIPModel

DB_PATH = os.environ.get("PHOTO_DB_PATH", "photo-db.sqlite")
MODEL_NAME = os.environ.get("CLIP_MODEL", "openai/clip-vit-base-patch32")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

app = FastAPI(title="Photo Semantic Service")

model = None
processor = None

photo_ids = None
emb_matrix = None
index_count = 0
last_loaded_ts = None


def _connect():
    return sqlite3.connect(DB_PATH)


def get_embedding_count():
    conn = _connect()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM photo_image_embeddings WHERE model = ?", (MODEL_NAME,))
    count = cur.fetchone()[0]
    conn.close()
    return count


def load_index():
    global photo_ids, emb_matrix, index_count, last_loaded_ts

    t0 = time.time()
    conn = _connect()
    cur = conn.cursor()
    cur.execute("""
        SELECT photo_id, embedding
        FROM photo_image_embeddings
        WHERE model = ?
    """, (MODEL_NAME,))
    rows = cur.fetchall()
    conn.close()

    if not rows:
        photo_ids = np.array([], dtype=np.int64)
        emb_matrix = np.zeros((0, 512), dtype=np.float32)
        index_count = 0
        last_loaded_ts = time.time()
        return

    ids = np.empty(len(rows), dtype=np.int64)
    first_vec = np.frombuffer(rows[0][1], dtype=np.float32)
    dim = first_vec.shape[0]
    mat = np.empty((len(rows), dim), dtype=np.float32)

    for i, (pid, blob) in enumerate(rows):
        ids[i] = int(pid)
        v = np.frombuffer(blob, dtype=np.float32)
        if v.shape[0] != dim:
            mat[i] = 0
        else:
            mat[i] = v

    norms = np.linalg.norm(mat, axis=1, keepdims=True) + 1e-12
    mat = mat / norms

    photo_ids = ids
    emb_matrix = mat
    index_count = len(rows)
    last_loaded_ts = time.time()

    print(f"[semantic] index reloaded → {index_count} vectors in {round(time.time()-t0,2)}s")


def ensure_model():
    global model, processor
    if model is None:
        print("[semantic] loading model...")
        model = CLIPModel.from_pretrained(MODEL_NAME).to(DEVICE)
        model.eval()
        processor = CLIPProcessor.from_pretrained(MODEL_NAME)
        print("[semantic] model ready")


def maybe_reload_index():
    global index_count
    current_count = get_embedding_count()
    if current_count != index_count:
        print(f"[semantic] detected embedding count change {index_count} → {current_count}")
        load_index()


def text_embedding(q: str) -> np.ndarray:
    inputs = processor(text=[q], return_tensors="pt", padding=True, truncation=True)
    input_ids = inputs["input_ids"].to(DEVICE)
    attention_mask = inputs["attention_mask"].to(DEVICE)

    with torch.no_grad():
        text_out = model.text_model(input_ids=input_ids, attention_mask=attention_mask)
        pooled = text_out.pooler_output
        feats = model.text_projection(pooled)

    feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats[0].cpu().numpy().astype(np.float32)


class SearchResult(BaseModel):
    photo_id: int
    score: float


class SearchResponse(BaseModel):
    query: str
    count: int
    took_ms: int
    index_count: int
    results: list[SearchResult]


@app.on_event("startup")
def startup():
    ensure_model()
    load_index()
    print(f"[semantic] device={DEVICE} ready")


@app.get("/health")
def health():
    return {
        "ok": True,
        "device": DEVICE,
        "index_count": index_count,
        "last_loaded_ts": last_loaded_ts
    }


@app.get("/search", response_model=SearchResponse)
def search(q: str = Query(...), k: int = Query(50)):

    ensure_model()
    maybe_reload_index()

    if emb_matrix is None or index_count == 0:
        return SearchResponse(query=q, count=0, took_ms=0, index_count=0, results=[])

    t0 = time.time()

    qv = text_embedding(q)
    scores = emb_matrix @ qv

    kk = min(k, scores.shape[0])
    idx = np.argpartition(scores, -kk)[-kk:]
    idx = idx[np.argsort(scores[idx])[::-1]]

    results = [
        SearchResult(photo_id=int(photo_ids[i]), score=float(scores[i]))
        for i in idx
    ]

    took_ms = int((time.time() - t0) * 1000)

    return SearchResponse(
        query=q,
        count=len(results),
        took_ms=took_ms,
        index_count=index_count,
        results=results
    )
