import React from "react";
import type { Photo } from "../api";

type Props = {
  photos: Photo[];
  onPhotoClick?: (photo: Photo, event?: React.MouseEvent) => void;
  selectedIds?: Set<number>;
  selectMode?: boolean;
};

export function PhotoMasonry({
  photos,
  onPhotoClick,
  selectedIds = new Set(),
  selectMode = false,
}: Props) {
  // Placeholder so <img> never ends up with a missing/empty src.
  const PLACEHOLDER_SRC = React.useMemo(() => {
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='360' viewBox='0 0 480 360'>" +
      "<rect width='100%' height='100%' fill='#f3f4f6'/>" +
      "<path d='M90 250l90-110 70 85 60-70 90 95H90z' fill='#d1d5db'/>" +
      "<circle cx='170' cy='140' r='26' fill='#d1d5db'/>" +
      "<text x='50%' y='60%' text-anchor='middle' font-family='system-ui, -apple-system, Segoe UI, Roboto' font-size='20' fill='#9ca3af'>No thumbnail</text>" +
      "</svg>";
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);

  // Best-effort API base (supports a couple common Vite env names).
  // If no env is present, use relative /api which works with Vite proxy in dev.
  const apiBase = React.useMemo(() => {
    const env = (import.meta as any)?.env ?? {};
    const base =
      env.VITE_API_BASE_URL ??
      env.VITE_API_BASE ??
      env.VITE_API_URL ??
      env.VITE_BACKEND_URL ??
      "";
    return typeof base === "string" ? base.replace(/\/+$/, "") : "";
  }, []);

  const resolveThumbnailSrc = React.useCallback(
    (p: Photo) => {
      const anyP = p as unknown as {
        id?: unknown;
        filename?: unknown;
        thumbnailUrl?: unknown;
        thumbnail_url?: unknown;
      };

      // 1) Prefer explicitly provided thumbnail URLs
      const candidates = [anyP.thumbnailUrl, anyP.thumbnail_url];
      for (const v of candidates) {
        if (typeof v === "string" && v.trim().length > 0) return v.trim();
      }

      // 2) If we have an id, construct a known thumbnail endpoint
      const id = anyP.id;
      if (typeof id === "number" && Number.isFinite(id)) {
        const path = `/api/photos/${id}/thumbnail`;
        return apiBase ? `${apiBase}${path}` : path;
      }

      // 3) Last resort placeholder (still a valid src)
      return PLACEHOLDER_SRC;
    },
    [PLACEHOLDER_SRC, apiBase]
  );

  // Defensive logging: when photos are received/updated in this component
  const lastLoggedCountRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (lastLoggedCountRef.current === photos.length) return;
    lastLoggedCountRef.current = photos.length;

    const sample = photos[0]
      ? {
          id: (photos[0] as any).id,
          filename: (photos[0] as any).filename,
          thumbnailUrl: (photos[0] as any).thumbnailUrl,
          thumbnail_url: (photos[0] as any).thumbnail_url,
          resolved: resolveThumbnailSrc(photos[0]),
        }
      : null;

    // eslint-disable-next-line no-console
    console.info("[PhotoMasonry] photos loaded", { count: photos.length, apiBase, sample });
  }, [photos, apiBase, resolveThumbnailSrc]);

  // Log resolved thumbnail URL once per photo id to avoid noisy spam
  const loggedPhotoIdsRef = React.useRef<Set<number>>(new Set());

  return (
    <div className="w-full max-w-none">
      <div
        className="
          columns-[10rem] sm:columns-[12rem] md:columns-[14rem] lg:columns-[16rem] xl:columns-[18rem]
          [column-gap:0.5rem]
        "
      >
        {photos.map((p) => {
          const isSelected = selectedIds.has(p.id);
          const isFavorite = p.isFavorite;

          const thumbnailSrc = resolveThumbnailSrc(p);

          if (!loggedPhotoIdsRef.current.has(p.id)) {
            loggedPhotoIdsRef.current.add(p.id);
            // eslint-disable-next-line no-console
            console.info("[PhotoMasonry] resolved thumbnail", {
              id: p.id,
              filename: p.filename,
              src: thumbnailSrc,
              raw: {
                thumbnailUrl: (p as any).thumbnailUrl,
                thumbnail_url: (p as any).thumbnail_url,
              },
            });
          }

          return (
            <div key={String(p.id)} className="mb-2 break-inside-avoid relative group">
              {(selectMode || isSelected) && (
                <div className="absolute top-2 left-2 z-10">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      onPhotoClick?.(p, { ctrlKey: true } as React.MouseEvent);
                    }}
                    className="w-5 h-5 rounded border-2 border-white bg-black/50 text-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {isFavorite && (
                <div className="absolute top-2 right-2 z-10">
                  <div className="w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center">
                    <span className="text-xs text-black">★</span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={(e) => onPhotoClick?.(p, e)}
                className={`
                  block w-full text-left relative overflow-hidden rounded-xl shadow-sm transition-all
                  ${isSelected ? "ring-4 ring-blue-500 ring-offset-2 scale-95" : "hover:opacity-95 hover:scale-105"}
                  ${selectMode ? "cursor-pointer" : "cursor-zoom-in"}
                `}
              >
                <img
                  src={thumbnailSrc}
                  alt={p.filename ?? ""}
                  loading="lazy"
                  decoding="async"
                  className={`
                    w-full h-auto rounded-xl transition-all
                    ${isSelected ? "brightness-75" : ""}
                  `}
                />

                {isSelected && <div className="absolute inset-0 bg-blue-500/20 rounded-xl" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
