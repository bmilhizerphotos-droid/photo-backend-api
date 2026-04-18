import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  FaceCluster,
  FaceClusterMatch,
  fetchFaceClusters,
  confirmFaceCluster,
  rejectFaceCluster,
} from "../api";
import { FaceExpandModal } from "./FaceExpandModal";

interface UnidentifiedFacesProps {
  onBack: () => void;
}

// ── Inline cluster review modal ───────────────────────────────────────────────
function ClusterReviewModal({
  cluster,
  name,
  onConfirm,
  onCancel,
}: {
  cluster: FaceCluster;
  name: string;
  onConfirm: (faceIds: number[], photoIds: number[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    new Set(cluster.matches.map((m) => m.faceId))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const toggle = (faceId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(faceId) ? next.delete(faceId) : next.add(faceId);
      return next;
    });

  const handleConfirm = async () => {
    if (!selected.size) return;
    setSaving(true);
    try {
      const sel = cluster.matches.filter((m) => selected.has(m.faceId));
      await onConfirm(
        sel.map((m) => m.faceId),
        [...new Set(sel.map((m) => m.photoId))]
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Review cluster{name ? ` — tagging as "${name}"` : ""}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {selected.size} of {cluster.matches.length} selected
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-4">
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {cluster.matches.map((m) => {
              const isSel = selected.has(m.faceId);
              return (
                <button
                  key={m.faceId}
                  onClick={() => toggle(m.faceId)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    isSel
                      ? "border-yellow-500 ring-2 ring-yellow-300"
                      : "border-transparent opacity-50 grayscale"
                  }`}
                >
                  <img src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute bottom-1 right-1 bg-black/60 rounded px-1 py-0.5 text-[10px] text-white font-mono">
                    {(m.confidence * 100).toFixed(0)}%
                  </div>
                  {isSel && (
                    <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-white text-[10px] font-bold">
                      ✓
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-3 border-t flex items-center justify-between shrink-0 bg-gray-50 rounded-b-2xl">
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set(cluster.matches.map((m) => m.faceId)))}
              className="text-xs text-blue-600 hover:underline"
            >
              Select all
            </button>
            <span className="text-gray-300">|</span>
            <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:underline">
              Clear
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-sm rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || !selected.size || !name.trim()}
              className="px-4 py-1.5 text-sm rounded-full bg-yellow-500 hover:bg-yellow-600 text-white font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : `Confirm ${selected.size}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Individual cluster row ────────────────────────────────────────────────────
interface ClusterRowProps {
  cluster: FaceCluster;
  onConfirm: (cluster: FaceCluster, name: string, faceIds: number[], photoIds: number[]) => Promise<void>;
  onReject: (cluster: FaceCluster) => Promise<void>;
  onExpand: (match: FaceClusterMatch) => void;
}

function ClusterRow({ cluster, onConfirm, onReject, onExpand }: ClusterRowProps) {
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [nameError, setNameError] = useState(false);

  const allFaceIds = cluster.matches.map((m) => m.faceId);
  const allPhotoIds = [...new Set(cluster.matches.map((m) => m.photoId))];
  const busy = confirming || rejecting;

  const handleConfirmAll = async () => {
    if (!name.trim()) { setNameError(true); return; }
    setNameError(false);
    setConfirming(true);
    try {
      await onConfirm(cluster, name.trim(), allFaceIds, allPhotoIds);
    } finally {
      setConfirming(false);
    }
  };

  const handleReject = async () => {
    setRejecting(true);
    try {
      await onReject(cluster);
    } finally {
      setRejecting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3">
        {/* Clickable thumbnail strip */}
        <div className="flex gap-1 shrink-0">
          {cluster.matches.slice(0, 5).map((m) => (
            <button
              key={m.faceId}
              onClick={() => onExpand(m)}
              className="w-10 h-10 rounded-md overflow-hidden border-2 border-yellow-300 hover:border-yellow-500 hover:scale-105 transition-all focus:outline-none focus:ring-2 focus:ring-yellow-400"
              title="Click to view full photo"
            >
              <img src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
          {cluster.size > 5 && (
            <div className="w-10 h-10 rounded-md border-2 border-yellow-200 bg-yellow-100 flex items-center justify-center text-xs text-yellow-700 font-medium">
              +{cluster.size - 5}
            </div>
          )}
        </div>

        {/* Label + name input */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-800">
            {cluster.size} face{cluster.size !== 1 ? "s" : ""} look like they belong to the same person
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirmAll(); }}
              placeholder="Enter a name…"
              className={`text-sm border rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent w-44 ${
                nameError ? "border-red-400 bg-red-50" : "border-gray-300"
              }`}
            />
            {nameError && <span className="text-xs text-red-500">Name required</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setReviewing(true)}
            disabled={busy}
            className="px-3 py-1 text-xs font-medium rounded-full border border-yellow-400 text-yellow-800 hover:bg-yellow-100 disabled:opacity-50 transition-colors"
          >
            Review
          </button>
          <button
            onClick={handleConfirmAll}
            disabled={busy}
            className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-500 hover:bg-yellow-600 text-white disabled:opacity-50 transition-colors"
          >
            {confirming ? "Saving…" : "Confirm All"}
          </button>
          <button
            onClick={handleReject}
            disabled={busy}
            className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
            title="Skip this cluster permanently"
          >
            {rejecting ? (
              <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {reviewing && (
        <ClusterReviewModal
          cluster={cluster}
          name={name}
          onConfirm={async (faceIds, photoIds) => {
            await onConfirm(cluster, name.trim() || "Unknown", faceIds, photoIds);
            setReviewing(false);
          }}
          onCancel={() => setReviewing(false)}
        />
      )}
    </>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────
export function UnidentifiedFaces({ onBack }: UnidentifiedFacesProps) {
  const [clusters, setClusters] = useState<FaceCluster[]>([]);
  const [totalClusters, setTotalClusters] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandMatch, setExpandMatch] = useState<FaceClusterMatch | null>(null);
  const initialized = useRef(false);
  const LIMIT = 10;

  const loadClusters = useCallback(async (pageNum: number, append: boolean, forceRefresh = false) => {
    pageNum === 0 ? setLoading(true) : setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchFaceClusters(pageNum, LIMIT, forceRefresh);
      setClusters((prev) => (append ? [...prev, ...data.clusters] : data.clusters));
      setTotalClusters(data.totalClusters);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clusters");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadClusters(0, false, false);
    }
  }, [loadClusters]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    loadClusters(next, true, false);
  };

  const handleRecompute = () => {
    setPage(0);
    setClusters([]);
    initialized.current = true;
    loadClusters(0, false, true);
  };

  const handleConfirm = useCallback(async (cluster: FaceCluster, name: string, faceIds: number[], photoIds: number[]) => {
    await confirmFaceCluster(name, faceIds, photoIds);
    setClusters((prev) => prev.filter((c) => c.clusterId !== cluster.clusterId));
    setTotalClusters((t) => Math.max(0, t - 1));
  }, []);

  const handleReject = useCallback(async (cluster: FaceCluster) => {
    await rejectFaceCluster(cluster.matches.map((m) => m.faceId));
    setClusters((prev) => prev.filter((c) => c.clusterId !== cluster.clusterId));
    setTotalClusters((t) => Math.max(0, t - 1));
  }, []);

  const hasMore = clusters.length < totalClusters;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to People
          </button>
          <h2 className="text-xl font-bold text-gray-900">Unidentified Face Clusters</h2>
        </div>
        <div className="flex items-center gap-3">
          {!loading && totalClusters > 0 && (
            <span className="text-sm text-gray-500">
              {totalClusters} cluster{totalClusters !== 1 ? "s" : ""} found
            </span>
          )}
          <button
            onClick={handleRecompute}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            Recompute
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={handleRecompute} className="text-sm text-red-600 hover:text-red-800 underline ml-4">
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-yellow-500 rounded-full animate-spin mb-3" />
          <p className="text-sm">Clustering faces… this may take a moment</p>
          <p className="text-xs mt-1 text-gray-300">Analyzing up to 3,000 face embeddings</p>
        </div>
      ) : clusters.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-5xl mb-4">🎉</div>
          <h3 className="text-lg font-medium mb-2">No clusters found</h3>
          <p className="text-sm">All faces are either identified or have no similar matches at 90% similarity.</p>
          <button onClick={handleRecompute} className="mt-4 text-sm text-blue-600 hover:underline">
            Recompute
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 mb-6">
            {clusters.map((c) => (
              <ClusterRow
                key={c.clusterId}
                cluster={c}
                onConfirm={handleConfirm}
                onReject={handleReject}
                onExpand={setExpandMatch}
              />
            ))}
          </div>

          {hasMore && (
            <div className="text-center pb-6">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-6 py-2 rounded-full bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                {loadingMore ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Loading…
                  </>
                ) : (
                  `Load More (${clusters.length} of ${totalClusters} shown)`
                )}
              </button>
            </div>
          )}
        </>
      )}

      {expandMatch && (
        <FaceExpandModal
          imageUrl={expandMatch.thumbnailUrl.replace(/\/thumbnails\/(\d+)/, "/api/photos/$1/file")}
          faceBbox={expandMatch.faceBbox}
          personName="Unidentified"
          onClose={() => setExpandMatch(null)}
        />
      )}
    </div>
  );
}
