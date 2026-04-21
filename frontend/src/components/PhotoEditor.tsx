import React, { useState, useRef, useCallback, useEffect } from "react";
import { Photo, editAutoCorrect, editUpscale, editSave } from "../api";

interface CropRect { x: number; y: number; w: number; h: number } // 0–1 fractions
interface EditState {
  rotation: 0 | 90 | 180 | 270;
  brightness: number;
  contrast: number;
  useUpscaled: boolean;
}

const DEFAULT: EditState = { rotation: 0, brightness: 1, contrast: 1, useUpscaled: false };

interface Props {
  photo: Photo;
  onClose: () => void;
  onSaved: () => void;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

const HANDLES: { name: Handle; pos: string; cursor: string }[] = [
  { name: "nw", pos: "-top-1.5 -left-1.5",                    cursor: "cursor-nw-resize" },
  { name: "n",  pos: "-top-1.5 left-1/2 -translate-x-1/2",   cursor: "cursor-n-resize"  },
  { name: "ne", pos: "-top-1.5 -right-1.5",                   cursor: "cursor-ne-resize" },
  { name: "e",  pos: "top-1/2 -right-1.5 -translate-y-1/2",  cursor: "cursor-e-resize"  },
  { name: "se", pos: "-bottom-1.5 -right-1.5",                cursor: "cursor-se-resize" },
  { name: "s",  pos: "-bottom-1.5 left-1/2 -translate-x-1/2",cursor: "cursor-s-resize"  },
  { name: "sw", pos: "-bottom-1.5 -left-1.5",                 cursor: "cursor-sw-resize" },
  { name: "w",  pos: "top-1/2 -left-1.5 -translate-y-1/2",   cursor: "cursor-w-resize"  },
];

export default function PhotoEditor({ photo, onClose, onSaved }: Props) {
  const [current, setCurrent] = useState<EditState>(DEFAULT);
  const [history, setHistory]  = useState<EditState[]>([]);
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });

  const [aiLoading,      setAiLoading]      = useState(false);
  const [upscaleLoading, setUpscaleLoading] = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [status,         setStatus]         = useState<{ msg: string; err?: boolean } | null>(null);

  const imgWrapRef = useRef<HTMLDivElement>(null);
  const dragging   = useRef<Handle | null>(null);
  const dragOrigin = useRef<{ mx: number; my: number; rect: CropRect } | null>(null);

  // ── History helpers ──────────────────────────────────────────────────────────
  const snapshot = useCallback(() => setHistory(h => [...h, current]), [current]);

  const undo = useCallback(() => {
    setHistory(h => {
      if (!h.length) return h;
      setCurrent(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const pushEdit = useCallback((patch: Partial<EditState>) => {
    setHistory(h => [...h, current]);
    setCurrent(c => ({ ...c, ...patch }));
  }, [current]);

  // ── Crop mouse events ────────────────────────────────────────────────────────
  const onHandleDown = useCallback((handle: Handle) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // prevent bubbling to crop box "move" handler
    dragging.current   = handle;
    dragOrigin.current = { mx: e.clientX, my: e.clientY, rect: { ...cropRect } };
  }, [cropRect]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !dragOrigin.current || !imgWrapRef.current) return;
      const { width, height } = imgWrapRef.current.getBoundingClientRect();
      const dx = (e.clientX - dragOrigin.current.mx) / width;
      const dy = (e.clientY - dragOrigin.current.my) / height;
      const r  = { ...dragOrigin.current.rect };
      const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

      if (dragging.current === "move") {
        r.x = cl(r.x + dx, 0, 1 - r.w);
        r.y = cl(r.y + dy, 0, 1 - r.h);
      } else {
        const h = dragging.current;
        if (h.includes("e")) { r.w = cl(r.w + dx, 0.05, 1 - r.x); }
        if (h.includes("w")) { const nx = cl(r.x + dx, 0, r.x + r.w - 0.05); r.w += r.x - nx; r.x = nx; }
        if (h.includes("s")) { r.h = cl(r.h + dy, 0.05, 1 - r.y); }
        if (h.includes("n")) { const ny = cl(r.y + dy, 0, r.y + r.h - 0.05); r.h += r.y - ny; r.y = ny; }
      }
      setCropRect(r);
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // ── AI auto-correct ──────────────────────────────────────────────────────────
  const handleAiAuto = async () => {
    setAiLoading(true);
    setStatus({ msg: "Analyzing image histogram…" });
    try {
      const result = await editAutoCorrect(photo.id);
      const brightness = typeof result.brightness === "number" && isFinite(result.brightness) ? result.brightness : 1;
      const contrast   = typeof result.contrast   === "number" && isFinite(result.contrast)   ? result.contrast   : 1;
      pushEdit({ brightness, contrast });
      const detail = result.notes ? ` — ${result.notes}` : ` (brightness ${brightness.toFixed(2)}, contrast ${contrast.toFixed(2)})`;
      setStatus({ msg: `AI auto-correct applied${detail}` });
    } catch (e: any) {
      setStatus({ msg: e.message, err: true });
    } finally {
      setAiLoading(false);
    }
  };

  // ── Upscale ──────────────────────────────────────────────────────────────────
  const handleUpscale = async () => {
    setUpscaleLoading(true);
    setStatus({ msg: "Upscaling 2× with Lanczos3…" });
    try {
      await editUpscale(photo.id);
      pushEdit({ useUpscaled: true });
      setStatus({ msg: "2× upscale ready — will apply on Save" });
    } catch (e: any) {
      setStatus({ msg: e.message, err: true });
    } finally {
      setUpscaleLoading(false);
    }
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setStatus({ msg: "Saving changes…" });
    try {
      await editSave({
        photoId: photo.id,
        rotation: current.rotation,
        brightness: current.brightness,
        contrast: current.contrast,
        crop: cropMode ? cropRect : null,
        useUpscaled: current.useUpscaled,
      });
      onSaved();
    } catch (e: any) {
      setStatus({ msg: e.message, err: true });
      setSaving(false);
    }
  };

  // ── Image preview styles (live) ───────────────────────────────────────────────
  const previewFilter    = `brightness(${current.brightness}) contrast(${current.contrast})`;
  const previewTransform = cropMode ? "none" : `rotate(${current.rotation}deg)`;

  return (
    <div className="fixed inset-0 z-[70] bg-black/95 flex flex-col select-none">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm truncate max-w-[200px]">{photo.filename}</span>
          <button
            onClick={undo}
            disabled={!history.length}
            className="px-3 py-1 text-xs rounded border border-gray-600 hover:bg-gray-700 disabled:opacity-30 transition-colors"
          >
            ↩ Undo
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded border border-gray-600 hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || aiLoading || upscaleLoading}
            className="px-4 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* ── Status bar ── */}
      {status && (
        <div className={`px-4 py-1.5 text-xs text-center shrink-0 ${status.err ? "bg-red-900/60 text-red-300" : "bg-gray-800 text-gray-300"}`}>
          {status.msg}
          <button onClick={() => setStatus(null)} className="ml-3 opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Image area ── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-4 min-h-0">
        <div className="relative inline-block" style={{ lineHeight: 0 }} ref={imgWrapRef}>
          <img
            src={photo.image_url}
            alt={photo.filename}
            draggable={false}
            className="block max-w-[80vw] max-h-[60vh] object-contain rounded"
            style={{ filter: previewFilter, transform: previewTransform, transition: "filter .2s, transform .3s" }}
          />

          {/* Crop overlay */}
          {cropMode && (
            <div className="absolute inset-0 pointer-events-none">
              {/* Dark masks — four regions outside the crop rect */}
              <div className="absolute bg-black/60" style={{ top: 0, left: 0, right: 0, height: `${cropRect.y * 100}%` }} />
              <div className="absolute bg-black/60" style={{ left: 0, right: 0, bottom: 0, top: `${(cropRect.y + cropRect.h) * 100}%` }} />
              <div className="absolute bg-black/60" style={{ top: `${cropRect.y * 100}%`, bottom: `${(1 - cropRect.y - cropRect.h) * 100}%`, left: 0, width: `${cropRect.x * 100}%` }} />
              <div className="absolute bg-black/60" style={{ top: `${cropRect.y * 100}%`, bottom: `${(1 - cropRect.y - cropRect.h) * 100}%`, right: 0, left: `${(cropRect.x + cropRect.w) * 100}%` }} />

              {/* Crop box */}
              <div
                className="absolute border-2 border-white pointer-events-auto cursor-move"
                style={{ left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`, width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%` }}
                onMouseDown={onHandleDown("move")}
              >
                {/* Rule-of-thirds grid */}
                <div className="absolute inset-0 pointer-events-none opacity-40" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr 1fr" }}>
                  {Array.from({ length: 9 }).map((_, i) => <div key={i} className="border border-white/50" />)}
                </div>
                {/* Handles */}
                {HANDLES.map(({ name, pos, cursor }) => (
                  <div
                    key={name}
                    className={`absolute w-3 h-3 bg-white rounded-sm shadow ${pos} ${cursor}`}
                    onMouseDown={onHandleDown(name)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="bg-gray-900 text-white px-4 py-3 shrink-0 flex flex-wrap gap-x-6 gap-y-3 items-center border-t border-gray-800">

        {/* Rotate */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-10">Rotate</span>
          <button onClick={() => pushEdit({ rotation: ((current.rotation - 90 + 360) % 360) as EditState["rotation"] })}
            className="px-2.5 py-1 text-sm border border-gray-600 rounded hover:bg-gray-700">↺</button>
          <button onClick={() => pushEdit({ rotation: ((current.rotation + 90) % 360) as EditState["rotation"] })}
            className="px-2.5 py-1 text-sm border border-gray-600 rounded hover:bg-gray-700">↻</button>
          <span className="text-xs text-gray-500">{current.rotation}°</span>
        </div>

        {/* Brightness */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-16">Brightness</span>
          <input type="range" min="0.5" max="2" step="0.05"
            value={current.brightness}
            onPointerDown={snapshot}
            onChange={e => setCurrent(c => ({ ...c, brightness: parseFloat(e.target.value) }))}
            className="w-28 accent-blue-500"
          />
          <span className="text-xs text-gray-400 w-8 tabular-nums">{current.brightness.toFixed(2)}</span>
        </div>

        {/* Contrast */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-16">Contrast</span>
          <input type="range" min="0.5" max="2" step="0.05"
            value={current.contrast}
            onPointerDown={snapshot}
            onChange={e => setCurrent(c => ({ ...c, contrast: parseFloat(e.target.value) }))}
            className="w-28 accent-blue-500"
          />
          <span className="text-xs text-gray-400 w-8 tabular-nums">{current.contrast.toFixed(2)}</span>
        </div>

        {/* Crop toggle */}
        <button
          onClick={() => setCropMode(v => !v)}
          className={`px-3 py-1 text-xs rounded border transition-colors ${cropMode ? "border-blue-500 bg-blue-900/40 text-blue-300" : "border-gray-600 hover:bg-gray-700"}`}
        >
          ✂ Crop {cropMode ? "(active)" : ""}
        </button>

        {/* AI Auto-Correct */}
        <button
          onClick={handleAiAuto}
          disabled={aiLoading || saving}
          className="px-3 py-1 text-xs rounded border border-gray-600 hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {aiLoading ? "Analyzing…" : "✨ Auto-Correct"}
        </button>

        {/* AI Upscale */}
        <button
          onClick={handleUpscale}
          disabled={upscaleLoading || current.useUpscaled || saving}
          className={`px-3 py-1 text-xs rounded border transition-colors disabled:opacity-40 ${
            current.useUpscaled ? "border-green-500 text-green-400" : "border-gray-600 hover:bg-gray-700"
          }`}
        >
          {upscaleLoading ? "Upscaling…" : current.useUpscaled ? "✓ Upscaled 2×" : "⬆ Upscale 2×"}
        </button>
      </div>
    </div>
  );
}
