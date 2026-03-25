import { useState, useEffect, useCallback, useRef } from "react";
import { fetchMemoryPhotos, MemoryPhoto, Memory } from "../api";

interface Props {
  memory: Memory;
  onClose: () => void;
}

const SLIDE_INTERVAL_MS = 4000;

export default function MemorySlideshow({ memory, onClose }: Props) {
  const [photos, setPhotos] = useState<MemoryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchMemoryPhotos(memory.id)
      .then((p) => { setPhotos(p); setLoading(false); })
      .catch(() => setLoading(false));
  }, [memory.id]);

  const goTo = useCallback((idx: number) => {
    setTransitioning(true);
    setTimeout(() => {
      setCurrent(idx);
      setTransitioning(false);
    }, 300);
  }, []);

  const next = useCallback(() => {
    if (photos.length === 0) return;
    goTo((current + 1) % photos.length);
  }, [current, photos.length, goTo]);

  const prev = useCallback(() => {
    if (photos.length === 0) return;
    goTo((current - 1 + photos.length) % photos.length);
  }, [current, photos.length, goTo]);

  // Auto-advance
  useEffect(() => {
    if (paused || photos.length <= 1) return;
    intervalRef.current = setInterval(next, SLIDE_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [paused, next, photos.length]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  function handleMusicUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (audioRef.current) {
      audioRef.current.src = URL.createObjectURL(file);
      audioRef.current.play();
    }
  }

  const photo = photos[current];
  const dateStr = memory.eventDateStart
    ? new Date(memory.eventDateStart).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" onClick={() => setPaused((p) => !p)}>
      {/* Hidden audio element for background music */}
      <audio ref={audioRef} loop className="hidden" />

      {/* Image */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {loading ? (
          <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : photo ? (
          <img
            key={photo.id}
            src={photo.imageUrl}
            alt={photo.filename}
            className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${transitioning ? "opacity-0" : "opacity-100"}`}
          />
        ) : null}

        {/* Gradient overlays */}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

        {/* Prev / Next buttons */}
        <button
          onClick={(e) => { e.stopPropagation(); prev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center text-xl transition-colors"
        >
          ‹
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center text-xl transition-colors"
        >
          ›
        </button>
      </div>

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-start justify-between pointer-events-none">
        <div className="pointer-events-auto">
          <h2 className="text-white font-semibold text-lg drop-shadow">{memory.title ?? "Memory"}</h2>
          <p className="text-white/70 text-sm">{dateStr}</p>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Music upload */}
          <label className="cursor-pointer text-white/70 hover:text-white text-sm flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 transition-colors" title="Add background music">
            🎵
            <input type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
          </label>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-white/70 hover:text-white text-2xl leading-none px-2 py-1 rounded hover:bg-white/10 transition-colors">
            ×
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-0 inset-x-0 p-4 pointer-events-none">
        {/* Dot indicators */}
        {photos.length > 1 && photos.length <= 30 && (
          <div className="flex justify-center gap-1.5 mb-3 pointer-events-auto">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); goTo(i); }}
                className={`w-1.5 h-1.5 rounded-full transition-all ${i === current ? "bg-white w-3" : "bg-white/40"}`}
              />
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pointer-events-auto">
          <p className="text-white/60 text-xs">
            {photos.length > 0 ? `${current + 1} / ${photos.length}` : ""}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); setPaused((p) => !p); }}
            className="text-white/70 hover:text-white text-sm px-3 py-1 rounded hover:bg-white/10 transition-colors"
          >
            {paused ? "▶ Play" : "⏸ Pause"}
          </button>
          <p className="text-white/40 text-xs">← → keys · Space to pause · Esc to exit</p>
        </div>
      </div>
    </div>
  );
}
