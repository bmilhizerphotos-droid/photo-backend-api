import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Photo,
  Person,
  fetchPhotoTaggedPeople,
  tagPersonInPhoto,
  removePersonTagFromPhoto,
  favoritePhoto,
  unfavoritePhoto,
  trashPhoto,
} from "../api";
import { PersonTagPicker } from "./PersonTagPicker";

interface ImageModalProps {
  photo: Photo | null;
  onClose: () => void;
  onEdit?: (photo: Photo) => void;
  onNext?: () => void;
  onPrev?: () => void;
}

const PERSON_COLORS: Record<string, string> = {
  Sarah: "#6366f1", Mom: "#db2777", Dad: "#2563eb", Jake: "#16a34a",
  Emma: "#d97706", "Grandma Rose": "#9333ea", "Uncle Tom": "#dc2626",
  Lily: "#0891b2", Max: "#65a30d",
};

function personColor(name: string) {
  return PERSON_COLORS[name] ?? "#6366f1";
}

export function ImageModal({ photo, onClose, onEdit, onNext, onPrev }: ImageModalProps) {
  const [taggedPeople, setTaggedPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Touch refs for pinch-to-zoom + swipe
  const pinchRef = useRef({ startDist: 0, startScale: 1 });
  const panRef = useRef({ startX: 0, startY: 0, panning: false });
  const swipeRef = useRef({ startX: 0, startY: 0, active: false });
  const lastTapRef = useRef(0);

  // Reset state when photo changes
  useEffect(() => {
    if (!photo) return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setShowInfo(false);
    setFavorited(!!(photo as any).is_favorite);
    setLoading(true);
    setError(null);
    setTaggedPeople([]);
    fetchPhotoTaggedPeople(photo.id)
      .then(setTaggedPeople)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tags"))
      .finally(() => setLoading(false));
  }, [photo?.id]);

  useEffect(() => {
    if (!photo) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (pickerOpen) setPickerOpen(false); else onClose(); }
      if (e.key === "ArrowRight" && zoom === 1) onNext?.();
      if (e.key === "ArrowLeft" && zoom === 1) onPrev?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [photo, pickerOpen, onClose, onNext, onPrev, zoom]);

  const handleAddTag = useCallback(async (person: Person) => {
    if (!photo) return;
    setProcessing(true);
    try {
      await tagPersonInPhoto(photo.id, person.id);
      setTaggedPeople((prev) => [...prev.filter((p) => p.id !== person.id), person]);
      setPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to tag person");
    } finally {
      setProcessing(false);
    }
  }, [photo]);

  const handleRemoveTag = useCallback(async (personId: number) => {
    if (!photo) return;
    setProcessing(true);
    try {
      await removePersonTagFromPhoto(photo.id, personId);
      setTaggedPeople((prev) => prev.filter((p) => p.id !== personId));
    } catch {
      setError("Failed to remove tag");
    } finally {
      setProcessing(false);
    }
  }, [photo]);

  const handleFavorite = useCallback(async () => {
    if (!photo) return;
    try {
      if (favorited) { await unfavoritePhoto(photo.id); setFavorited(false); }
      else { await favoritePhoto(photo.id); setFavorited(true); }
    } catch {}
  }, [photo, favorited]);

  const handleTrash = useCallback(async () => {
    if (!photo) return;
    if (!window.confirm("Move this photo to Trash?")) return;
    try {
      await trashPhoto(photo.id);
      onClose();
    } catch {}
  }, [photo, onClose]);

  // ── Touch handlers ──
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { startDist: Math.hypot(dx, dy), startScale: zoom };
    } else if (e.touches.length === 1) {
      if (zoom > 1) {
        panRef.current = { startX: e.touches[0].clientX - pan.x, startY: e.touches[0].clientY - pan.y, panning: true };
      } else {
        swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, active: true };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.min(4, Math.max(1, pinchRef.current.startScale * (dist / pinchRef.current.startDist)));
      setZoom(newScale);
      if (newScale === 1) setPan({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && panRef.current.panning && zoom > 1) {
      e.preventDefault();
      setPan({ x: e.touches[0].clientX - panRef.current.startX, y: e.touches[0].clientY - panRef.current.startY });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    panRef.current.panning = false;
    if (swipeRef.current.active && zoom <= 1 && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - swipeRef.current.startX;
      const dy = Math.abs(e.changedTouches[0].clientY - swipeRef.current.startY);
      if (Math.abs(dx) > 60 && dy < 80) {
        if (dx < 0) onNext?.();
        else onPrev?.();
      }
    }
    swipeRef.current.active = false;
  };

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); }
      else setZoom(2);
    }
    lastTapRef.current = now;
  };

  if (!photo) return null;

  const isMobile = window.innerWidth < 768;
  const imageUrl = photo.image_url ?? (photo as any).fullUrl;

  const TOOLBAR = [
    { id: "info",     tip: "Info",     path: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { id: "favorite", tip: "Favorite", path: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" },
    { id: "edit",     tip: "Edit",     path: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
    { id: "trash",    tip: "Delete",   path: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" },
    { id: "more",     tip: "More",     path: "M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "rgba(0,0,0,0.95)" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(20px)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer", fontSize: 15, padding: "8px 10px", borderRadius: 10 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          {!isMobile && <span style={{ fontSize: 13 }}>Back</span>}
        </button>
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {photo.filename}
        </span>
        <button
          onClick={() => setShowInfo((s) => !s)}
          style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: showInfo ? "rgba(255,255,255,0.15)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.7)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>

      {/* ── Main image area ── */}
      <div
        className="flex-1 relative overflow-hidden flex"
        onClick={handleDoubleTap}
      >
        {/* Prev arrow */}
        {onPrev && !isMobile && (
          <button
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", zIndex: 10, width: 40, height: 40, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        )}

        {/* Image */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            padding: showInfo && !isMobile ? "16px 340px 16px 16px" : "16px",
            transition: isMobile ? "none" : "padding 0.3s cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          <img
            src={imageUrl}
            alt={photo.filename}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: isMobile ? 0 : 12,
              userSelect: "none",
              WebkitUserSelect: "none",
              transition: zoom === 1 ? "transform 0.2s" : "none",
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              cursor: zoom > 1 ? "grab" : "zoom-in",
              touchAction: "none",
            }}
          />
        </div>

        {/* Zoom indicator */}
        {zoom > 1 && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", fontSize: 12, fontWeight: 600, color: "white", background: "rgba(0,0,0,0.5)", padding: "4px 12px", borderRadius: 20, backdropFilter: "blur(8px)" }}>
            {zoom.toFixed(1)}×
          </div>
        )}

        {/* Swipe hint on mobile */}
        {zoom === 1 && isMobile && (
          <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "rgba(255,255,255,0.3)", pointerEvents: "none", whiteSpace: "nowrap" }}>
            Pinch to zoom · swipe to navigate
          </div>
        )}

        {/* Info panel — slides from right (desktop) or bottom sheet (mobile) */}
        {showInfo && (
          isMobile ? (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(255,255,255,0.97)", backdropFilter: "blur(32px)", borderRadius: "20px 20px 0 0", padding: "20px 20px 32px", maxHeight: "60%", overflowY: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.2)" }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(0,0,0,0.12)", margin: "0 auto 16px" }} />
              <InfoPanelContent
                taggedPeople={taggedPeople}
                loading={loading}
                error={error}
                processing={processing}
                onAddTag={() => setPickerOpen(true)}
                onRemoveTag={handleRemoveTag}
                photo={photo}
              />
            </div>
          ) : (
            <div style={{ position: "absolute", top: 0, right: 0, width: 320, height: "100%", background: "rgba(255,255,255,0.95)", backdropFilter: "blur(32px)", borderLeft: "1px solid rgba(0,0,0,0.08)", overflowY: "auto", padding: 24, boxSizing: "border-box", boxShadow: "-8px 0 32px rgba(0,0,0,0.15)" }}>
              <InfoPanelContent
                taggedPeople={taggedPeople}
                loading={loading}
                error={error}
                processing={processing}
                onAddTag={() => setPickerOpen(true)}
                onRemoveTag={handleRemoveTag}
                photo={photo}
              />
            </div>
          )
        )}

        {/* Next arrow */}
        {onNext && !isMobile && (
          <button
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            style={{ position: "absolute", right: showInfo ? 336 : 16, top: "50%", transform: "translateY(-50%)", zIndex: 10, width: 40, height: 40, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "white", transition: "right 0.3s cubic-bezier(0.4,0,0.2,1)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        )}
      </div>

      {/* ── Bottom toolbar ── */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(20px)", padding: "8px 0 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 0 : 4, background: "rgba(255,255,255,0.08)", borderRadius: 32, padding: "4px 8px", border: "1px solid rgba(255,255,255,0.1)" }}>
          {TOOLBAR.map(({ id, tip, path }) => {
            const isActive = (id === "info" && showInfo) || (id === "favorite" && favorited);
            const isDanger = id === "trash";
            const isHidden = id === "edit" && !onEdit;
            if (isHidden) return null;
            return (
              <button
                key={id}
                title={tip}
                onClick={(e) => {
                  e.stopPropagation();
                  if (id === "info") setShowInfo((s) => !s);
                  else if (id === "favorite") void handleFavorite();
                  else if (id === "edit") onEdit?.(photo);
                  else if (id === "trash") void handleTrash();
                }}
                style={{
                  width: isMobile ? 46 : 44,
                  height: isMobile ? 46 : 44,
                  borderRadius: "50%",
                  border: "none",
                  background: isActive ? "rgba(255,255,255,0.15)" : "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isDanger ? "rgba(255,100,100,0.8)" : isActive ? (id === "favorite" ? "#f59e0b" : "white") : "rgba(255,255,255,0.65)",
                  transition: "all 0.15s",
                }}
              >
                <svg
                  width={isMobile ? 22 : 20}
                  height={isMobile ? 22 : 20}
                  viewBox="0 0 24 24"
                  fill={id === "favorite" && favorited ? "#f59e0b" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={path} />
                </svg>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tag picker overlay */}
      {pickerOpen && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
          <PersonTagPicker
            onSelect={handleAddTag}
            onCreateNew={() => {
              setError("Use the face tagging UI to create new people.");
              return Promise.reject(new Error("Create unsupported"));
            }}
            onCancel={() => setPickerOpen(false)}
            excludeIds={taggedPeople.map((p) => p.id)}
          />
        </div>
      )}
    </div>
  );
}

function InfoPanelContent({
  taggedPeople, loading, error, processing, onAddTag, onRemoveTag, photo,
}: {
  taggedPeople: Person[];
  loading: boolean;
  error: string | null;
  processing: boolean;
  onAddTag: () => void;
  onRemoveTag: (id: number) => void;
  photo: Photo;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", margin: 0 }}>Photo Info</h3>
        <button
          onClick={onAddTag}
          disabled={processing}
          style={{ fontSize: 12, color: "#6366f1", background: "transparent", border: "none", cursor: "pointer", fontWeight: 500 }}
        >
          + Add Tag
        </button>
      </div>

      {/* People tags */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px", fontWeight: 600 }}>People</p>
        {loading ? (
          <p style={{ fontSize: 13, color: "#94a3b8" }}>Loading…</p>
        ) : taggedPeople.length === 0 ? (
          <p style={{ fontSize: 13, color: "#94a3b8" }}>No tags yet.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {taggedPeople.map((person) => (
              <div
                key={person.id}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 10px 5px 5px", borderRadius: 20, background: `${personColor(person.name)}12`, border: `1px solid ${personColor(person.name)}30` }}
              >
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: personColor(person.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white" }}>
                  {person.name[0]}
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#0f172a" }}>{person.name}</span>
                <button
                  onClick={() => onRemoveTag(person.id)}
                  disabled={processing}
                  style={{ width: 14, height: 14, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 10, padding: 0 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* EXIF metadata */}
      {[
        ["Filename", photo.filename],
        ["Date taken", (photo as any).date_taken ? new Date((photo as any).date_taken).toLocaleDateString() : null],
        ["Added", new Date(photo.created_at).toLocaleDateString()],
      ].filter(([, v]) => v).map(([k, v]) => (
        <div key={k as string} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>{k}</span>
          <span style={{ fontSize: 12, color: "#475569", fontWeight: 500, textAlign: "right", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
        </div>
      ))}

      {error && <p style={{ fontSize: 12, color: "#dc2626", marginTop: 12 }}>{error}</p>}
    </>
  );
}
