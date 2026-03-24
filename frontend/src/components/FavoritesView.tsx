import React, { useCallback, useEffect, useRef, useState } from "react";
import { fetchFavorites, bulkAction, FavoritePhoto } from "../api";

interface Props {
  user: import("firebase/auth").User | null;
}

export default function FavoritesView({ user }: Props) {
  const [photos, setPhotos] = useState<FavoritePhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

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
      const result = await fetchFavorites(offsetRef.current, 50);
      setPhotos((prev) => reset ? result.photos : [...prev, ...result.photos]);
      setTotal(result.total);
      offsetRef.current += result.photos.length;
      hasMoreRef.current = result.hasMore;
      setHasMore(result.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load favorites");
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

  async function handleUnfavorite() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setActionLoading(true);
    try {
      await bulkAction('unfavorite', ids);
      setMessage({ text: `Removed ${ids.length} photo${ids.length > 1 ? "s" : ""} from favorites.`, type: "success" });
      setSelected(new Set());
      await load(true);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }

  const formatDate = (p: FavoritePhoto) => {
    const raw = p.dateTaken ?? p.createdAt;
    if (!raw) return "";
    return new Date(raw).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  if (!user) return null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Favorites</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} favorited photo{total !== 1 ? "s" : ""}</p>
        </div>
      </div>

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
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-500">{selected.size} selected</span>
          <button
            onClick={handleUnfavorite}
            disabled={actionLoading}
            className="px-3 py-1.5 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 disabled:opacity-50 flex items-center gap-1.5"
          >
            <span>★</span>
            {actionLoading ? "Removing…" : `Remove from favorites (${selected.size})`}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">Loading favorites…</div>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <span className="text-5xl mb-3">★</span>
          <p className="text-lg font-medium">No favorites yet</p>
          <p className="text-sm mt-1">Select photos in the gallery and tap Favorite to add them here.</p>
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
                {/* Star badge */}
                <div className="absolute top-1 right-1 w-5 h-5 bg-yellow-400 rounded-full flex items-center justify-center shadow">
                  <span className="text-xs text-yellow-900 leading-none">★</span>
                </div>
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
                {/* Date tooltip */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity truncate">
                  {formatDate(photo)}
                </div>
              </div>
            ))}
          </div>
          <div ref={sentinelRef} className="h-8 flex items-center justify-center mt-4">
            {loadingMore && <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />}
          </div>
        </>
      )}
    </div>
  );
}
