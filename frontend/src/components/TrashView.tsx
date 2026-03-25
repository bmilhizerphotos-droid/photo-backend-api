import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchTrash,
  restorePhotos,
  permanentlyDeletePhotos,
  emptyTrash,
  TrashPhoto,
} from "../api";

interface Props {
  user: import("firebase/auth").User | null;
}

export default function TrashView({ user }: Props) {
  const [photos, setPhotos] = useState<TrashPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [confirmPermanent, setConfirmPermanent] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);

  const offsetRef = useRef(0);
  const hasMoreRef = useRef(false);
  const inFlight = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (reset = false) => {
    if (!user) return;
    if (reset) {
      setLoading(true);
      offsetRef.current = 0;
      hasMoreRef.current = false;
      setPhotos([]);
      setSelected(new Set());
    }
    try {
      const result = await fetchTrash(offsetRef.current, 50);
      setPhotos((prev) => reset ? result.photos : [...prev, ...result.photos]);
      setTotal(result.total);
      if ((result as any).retentionDays) setRetentionDays((result as any).retentionDays);
      offsetRef.current += result.photos.length;
      hasMoreRef.current = result.hasMore;
      setHasMore(result.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trash");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      inFlight.current = false;
    }
  }, [user]);

  useEffect(() => { load(true); }, [load]);

  // Infinite scroll
  const loadMore = useCallback(() => {
    if (inFlight.current || !hasMoreRef.current) return;
    inFlight.current = true;
    setLoadingMore(true);
    load(false);
  }, [load]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectAll) {
      setSelected(new Set());
      setSelectAll(false);
    } else {
      setSelected(new Set(photos.map((p) => p.id)));
      setSelectAll(true);
    }
  }

  async function handleRestore() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setActionLoading(true);
    try {
      await restorePhotos(ids);
      setMessage({ text: `Restored ${ids.length} photo${ids.length > 1 ? "s" : ""}.`, type: "success" });
      setSelected(new Set());
      setSelectAll(false);
      await load(true);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Restore failed", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleEmptyTrash() {
    setActionLoading(true);
    setConfirmEmpty(false);
    try {
      const result = await emptyTrash();
      setMessage({ text: `Emptied trash — ${result.deleted} photo${result.deleted !== 1 ? "s" : ""} permanently removed.`, type: "success" });
      setSelected(new Set());
      setSelectAll(false);
      await load(true);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Empty trash failed", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePermanentDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setActionLoading(true);
    setConfirmPermanent(false);
    try {
      const result = await permanentlyDeletePhotos(ids);
      setMessage({ text: `Permanently deleted ${result.deleted} photo${result.deleted !== 1 ? "s" : ""}.`, type: "success" });
      setSelected(new Set());
      setSelectAll(false);
      await load(true);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Delete failed", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }

  const formatDate = (p: TrashPhoto) => {
    const raw = p.dateTaken ?? p.createdAt;
    if (!raw) return "";
    return new Date(raw).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  if (!user) return null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Trash</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total.toLocaleString()} deleted photo{total !== 1 ? "s" : ""} · Auto-deleted after {retentionDays} days
          </p>
        </div>
        {photos.length > 0 && (
          <button
            onClick={() => setConfirmEmpty(true)}
            disabled={actionLoading}
            className="px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            Empty Trash
          </button>
        )}
      </div>

      {/* Message banner */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg flex items-center justify-between text-sm ${
          message.type === "success" ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"
        }`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-3 opacity-60 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      {/* Action bar */}
      {photos.length > 0 && (
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300 text-blue-500 cursor-pointer"
            />
            Select all ({photos.length.toLocaleString()} loaded)
          </label>

          {selected.size > 0 && (
            <>
              <span className="text-sm text-gray-500">{selected.size} selected</span>
              <button
                onClick={handleRestore}
                disabled={actionLoading}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? "…" : `Restore (${selected.size})`}
              </button>
              <button
                onClick={() => setConfirmPermanent(true)}
                disabled={actionLoading}
                className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Delete permanently ({selected.size})
              </button>
            </>
          )}
        </div>
      )}

      {/* Confirm permanent delete dialog */}
      {confirmPermanent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Delete permanently?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently remove {selected.size} photo{selected.size !== 1 ? "s" : ""} from the database.
              The files on disk will not be touched, but these photos will no longer appear in the app.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmPermanent(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handlePermanentDelete}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty Trash confirm */}
      {confirmEmpty && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Empty Trash?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently remove all {total.toLocaleString()} photo{total !== 1 ? "s" : ""} in the trash from the database. Files on disk are not touched.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmEmpty(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={handleEmptyTrash} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">Empty Trash</button>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">Loading trash…</div>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <span className="text-5xl mb-3">🗑️</span>
          <p className="text-lg font-medium">Trash is empty</p>
          <p className="text-sm mt-1">Deleted photos from Duplicates will appear here.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1">
            {photos.map((photo) => (
              <div
                key={photo.id}
                onClick={() => toggleSelect(photo.id)}
                className={`relative aspect-square cursor-pointer group rounded overflow-hidden border-2 transition-all ${
                  selected.has(photo.id) ? "border-blue-500 ring-2 ring-blue-300" : "border-transparent hover:border-gray-300"
                }`}
              >
                <img
                  src={photo.thumbnailUrl}
                  alt={photo.filename}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {/* Checkbox overlay */}
                <div className={`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-opacity ${
                  selected.has(photo.id)
                    ? "bg-blue-500 border-blue-500 opacity-100"
                    : "bg-white/70 border-gray-400 opacity-0 group-hover:opacity-100"
                }`}>
                  {selected.has(photo.id) && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                {/* Days left badge */}
                {(photo as any).daysLeft != null && (photo as any).daysLeft <= 7 && (
                  <div className="absolute top-1 right-1 bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded leading-none">
                    {(photo as any).daysLeft}d
                  </div>
                )}
                {/* Date tooltip */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity truncate">
                  {formatDate(photo)}
                </div>
              </div>
            ))}
          </div>
          <div ref={sentinelRef} className="h-8 flex items-center justify-center mt-4">
            {loadingMore && <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />}
          </div>
        </>
      )}
    </div>
  );
}
