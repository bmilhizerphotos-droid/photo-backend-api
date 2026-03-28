import { useState, useEffect, useRef, useCallback } from "react";
import { fetchVideos, startVideoScan, fetchVideoScanStatus, VideoItem } from "../api";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface VideoPlayerProps {
  video: VideoItem;
  onClose: () => void;
}

function VideoPlayer({ video, onClose }: VideoPlayerProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="relative max-w-5xl w-full mx-4" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white text-sm"
        >
          ✕ Close
        </button>
        <video
          src={video.streamUrl}
          controls
          autoPlay
          className="w-full rounded-lg shadow-2xl"
          style={{ maxHeight: "80vh" }}
        >
          Your browser does not support video playback.
        </video>
        <p className="text-center text-white/60 text-sm mt-2">{video.filename}</p>
      </div>
    </div>
  );
}

export default function VideosView() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<VideoItem | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);

  const offsetRef = useRef(0);
  const hasMoreRef = useRef(false);
  const inFlight = useRef(false);

  const load = useCallback(async (reset = false) => {
    if (inFlight.current) return;
    const offset = reset ? 0 : offsetRef.current;
    inFlight.current = true;
    if (reset) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchVideos(offset, 50);
      setVideos(prev => reset ? data.videos : [...prev, ...data.videos]);
      setTotal(data.total);
      setHasMore(data.hasMore);
      hasMoreRef.current = data.hasMore;
      offsetRef.current = offset + data.videos.length;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load videos");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => { load(true); }, [load]);

  // Sentinel for infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMoreRef.current && !inFlight.current) {
        load(false);
      }
    }, { rootMargin: "400px" });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [load]);

  const handleScan = async () => {
    setScanning(true);
    setScanDone(false);
    try {
      await startVideoScan();
      // Poll until done
      const poll = setInterval(async () => {
        const s = await fetchVideoScanStatus();
        if (!s.running) {
          clearInterval(poll);
          setScanning(false);
          setScanDone(true);
          load(true);
        }
      }, 3000);
    } catch (e) {
      setScanning(false);
      setError(e instanceof Error ? e.message : "Scan failed");
    }
  };

  return (
    <div className="p-6">
      {playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Videos</h1>
          {!loading && (
            <p className="text-sm text-gray-500 mt-1">
              {total.toLocaleString()} video{total !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scanning ? "Scanning…" : "Scan for videos"}
        </button>
      </div>

      {scanDone && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
          Scan complete — videos reloaded.
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 animate-pulse">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="aspect-video bg-gray-200 rounded-lg" />
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-6xl mb-4">🎬</div>
          <h2 className="text-xl font-medium text-gray-700 mb-2">No videos yet</h2>
          <p className="text-sm text-gray-500 max-w-sm mb-4">
            Click "Scan for videos" to index video files from your photo library.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {videos.map(video => (
              <button
                key={video.id}
                onClick={() => setPlaying(video)}
                className="group relative aspect-video rounded-lg overflow-hidden bg-gray-900 hover:ring-2 hover:ring-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
              >
                <img
                  src={video.thumbnailUrl}
                  alt={video.filename}
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                  loading="lazy"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                {/* Play overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-black/70 transition">
                    <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
                {/* Duration badge */}
                {video.duration && (
                  <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                    {formatDuration(video.duration)}
                  </div>
                )}
                {/* Date badge */}
                {video.dateTaken && (
                  <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                    {new Date(video.dateTaken).getFullYear()}
                  </div>
                )}
              </button>
            ))}
          </div>
          {loadingMore && (
            <div className="mt-4 text-center text-sm text-gray-500">Loading more…</div>
          )}
          <div ref={sentinelRef} className="h-10" />
        </>
      )}
    </div>
  );
}
