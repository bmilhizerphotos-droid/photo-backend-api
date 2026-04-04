import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchScreenshots,
  startScreenshotScan,
  fetchScreenshotScanStatus,
  Photo,
} from '../api';
import { useIntersectionSentinel } from '../hooks/useIntersectionSentinel';

const PAGE_SIZE = 50;

export default function ScreenshotsView({
  onPhotoClick,
}: {
  onPhotoClick?: (photo: Photo) => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ running: boolean; total: number; scanned: number; screenshots: number } | null>(null);
  const [scanning, setScanning] = useState(false);

  const offsetRef = useRef(0);
  const hasMoreRef = useRef(false);
  const inFlightRef = useRef(false);

  async function loadFirst() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchScreenshots(0, PAGE_SIZE);
      setPhotos(result.photos);
      setTotal(result.total);
      hasMoreRef.current = result.hasMore;
      setHasMore(result.hasMore);
      offsetRef.current = result.photos.length;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load screenshots');
    } finally {
      setLoading(false);
    }
  }

  async function loadStatus() {
    try {
      const s = await fetchScreenshotScanStatus();
      setStatus(s);
      setScanning(s.running);
    } catch {}
  }

  useEffect(() => {
    loadFirst();
    loadStatus();
  }, []);

  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(async () => {
      await loadStatus();
      await loadFirst();
      if (!scanning) clearInterval(interval);
    }, 5000);
    return () => clearInterval(interval);
  }, [scanning]);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || !hasMoreRef.current) return;
    inFlightRef.current = true;
    setLoadingMore(true);
    try {
      const result = await fetchScreenshots(offsetRef.current, PAGE_SIZE);
      setPhotos((prev) => [...prev, ...result.photos]);
      offsetRef.current += result.photos.length;
      hasMoreRef.current = result.hasMore;
      setHasMore(result.hasMore);
    } catch {}
    finally { inFlightRef.current = false; setLoadingMore(false); }
  }, []);

  const sentinelRef = useIntersectionSentinel(loadMore, {
    enabled: !loading && hasMore && !loadingMore,
    rootMargin: '800px',
  });

  async function handleScan() {
    try {
      await startScreenshotScan();
      setScanning(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    }
  }

  const scannedPct =
    status && status.total > 0
      ? Math.round((status.scanned / status.total) * 100)
      : 0;

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Screenshots</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total > 0
              ? `${total.toLocaleString()} screenshot${total !== 1 ? 's' : ''} found`
              : 'No screenshots detected yet'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="aspect-[9/16] bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && photos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-6xl mb-4">🖥️</div>
          <h2 className="text-xl font-medium text-gray-700 mb-2">No screenshots found</h2>
          <p className="text-sm text-gray-500 max-w-sm">
            {status && status.scanned > 0
              ? 'No screenshots or recordings were detected in your library.'
              : 'Click "Scan for Screenshots" to have AI automatically detect screenshots, screen recordings, and captured UIs in your library. Uses the free Gemini AI tier — no cost.'}
          </p>
        </div>
      )}

      {!loading && photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
          {photos.map((photo) => (
            <button
              key={photo.id}
              onClick={() => onPhotoClick?.(photo)}
              className="group relative aspect-[9/16] rounded-lg overflow-hidden bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
              title={photo.filename}
            >
              <img
                src={photo.thumbnailUrl || photo.thumbnail_url}
                alt={photo.filename}
                className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-white text-[10px] truncate leading-tight">{photo.filename}</p>
                {photo.dateTaken && (
                  <p className="text-white/70 text-[9px]">
                    {new Date(photo.dateTaken).toLocaleDateString()}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-10" />
      {loadingMore && (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
