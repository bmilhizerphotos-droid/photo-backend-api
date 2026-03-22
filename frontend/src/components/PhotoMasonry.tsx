import React from "react";
import type { Photo } from "../api";

type Props = {
  photos: Photo[];
  onPhotoClick?: (photo: Photo, event?: React.MouseEvent) => void;
  selectedIds?: Set<number>;
  selectMode?: boolean;
  groupByDate?: boolean;
};

// Parse a date from photo metadata, handling SQLite "YYYY-MM-DD HH:MM:SS" format
function parsePhotoDate(photo: Photo): Date | null {
  const raw =
    (photo as any).dateTaken ??
    (photo as any).date_taken ??
    (photo as any).createdAt ??
    (photo as any).created_at ??
    null;
  if (!raw) return null;
  // SQLite uses space separator; replace with T for reliable parsing
  const str = String(raw).replace(" ", "T");
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function toMonthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toDayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatMonth(d: Date) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

function formatDay(d: Date) {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type DayGroup = { dayKey: string; dayLabel: string; photos: Photo[] };
type MonthGroup = { monthKey: string; monthLabel: string; days: DayGroup[] };

function groupPhotos(photos: Photo[]): MonthGroup[] {
  const monthMap = new Map<string, Map<string, Photo[]>>();
  const monthLabels = new Map<string, string>();
  const dayLabels = new Map<string, string>();

  for (const photo of photos) {
    const d = parsePhotoDate(photo);
    const mKey = d ? toMonthKey(d) : "0000-00";
    const dKey = d ? toDayKey(d) : "0000-00-00";
    const mLabel = d ? formatMonth(d) : "Unknown date";
    const dLabel = d ? formatDay(d) : "Unknown date";

    if (!monthMap.has(mKey)) {
      monthMap.set(mKey, new Map());
      monthLabels.set(mKey, mLabel);
    }
    const dayMap = monthMap.get(mKey)!;
    if (!dayMap.has(dKey)) {
      dayMap.set(dKey, []);
      dayLabels.set(dKey, dLabel);
    }
    dayMap.get(dKey)!.push(photo);
  }

  return Array.from(monthMap.entries()).map(([mKey, dayMap]) => ({
    monthKey: mKey,
    monthLabel: monthLabels.get(mKey)!,
    days: Array.from(dayMap.entries()).map(([dKey, dayPhotos]) => ({
      dayKey: dKey,
      dayLabel: dayLabels.get(dKey)!,
      photos: dayPhotos,
    })),
  }));
}

export function PhotoMasonry({
  photos,
  onPhotoClick,
  selectedIds = new Set(),
  selectMode = false,
  groupByDate = false,
}: Props) {
  const PLACEHOLDER_SRC = React.useMemo(() => {
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='360' viewBox='0 0 480 360'>" +
      "<rect width='100%' height='100%' fill='#f3f4f6'/>" +
      "<path d='M90 250l90-110 70 85 60-70 90 95H90z' fill='#d1d5db'/>" +
      "<circle cx='170' cy='140' r='26' fill='#d1d5db'/>" +
      "</svg>";
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);

  const resolveThumbnailSrc = React.useCallback(
    (p: Photo) => {
      const anyP = p as any;
      if (typeof anyP.thumbnail_url === "string" && anyP.thumbnail_url.length > 0)
        return anyP.thumbnail_url;
      if (typeof anyP.thumbnailUrl === "string" && anyP.thumbnailUrl.length > 0)
        return anyP.thumbnailUrl;
      if (typeof anyP.id === "number") return `/thumbnails/${anyP.id}`;
      return PLACEHOLDER_SRC;
    },
    [PLACEHOLDER_SRC]
  );

  const renderPhotoCell = (p: Photo) => {
    const isSelected = selectedIds.has(p.id);
    const thumbnailSrc = resolveThumbnailSrc(p);
    return (
      <div key={String(p.id)} className="relative group aspect-square bg-gray-100">
        {(selectMode || isSelected) && (
          <div className="absolute top-1.5 left-1.5 z-10">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onPhotoClick?.(p, { ctrlKey: true } as React.MouseEvent);
              }}
              className="w-5 h-5 rounded border-2 border-white bg-black/50 text-blue-500"
            />
          </div>
        )}
        {p.isFavorite && (
          <div className="absolute top-1.5 right-1.5 z-10 w-5 h-5 bg-yellow-400 rounded-full flex items-center justify-center">
            <span className="text-xs text-black leading-none">★</span>
          </div>
        )}
        <button
          type="button"
          onClick={(e) => onPhotoClick?.(p, e)}
          className={`
            w-full h-full overflow-hidden
            ${isSelected ? "ring-4 ring-inset ring-blue-500" : ""}
            ${selectMode ? "cursor-pointer" : "cursor-zoom-in"}
          `}
        >
          <img
            src={thumbnailSrc}
            alt={p.filename ?? ""}
            loading="lazy"
            decoding="async"
            className={`
              w-full h-full object-cover transition-opacity duration-200
              hover:brightness-90
              ${isSelected ? "brightness-75" : ""}
            `}
          />
          {isSelected && <div className="absolute inset-0 bg-blue-500/20" />}
        </button>
      </div>
    );
  };

  if (groupByDate) {
    const groups = groupPhotos(photos);
    return (
      <div className="w-full">
        {groups.map(({ monthKey, monthLabel, days }) => (
          <div key={monthKey} className="mb-6">
            <h2 className="text-lg font-medium text-gray-800 px-1 mb-3 sticky top-0 bg-white/95 backdrop-blur-sm py-2 z-10">
              {monthLabel}
            </h2>
            {days.map(({ dayKey, dayLabel, photos: dayPhotos }) => (
              <div key={dayKey} className="mb-4">
                <p className="text-sm text-gray-500 px-1 mb-1.5">{dayLabel}</p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-px">
                  {dayPhotos.map(renderPhotoCell)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // Default: masonry layout (used for search results, person photos, etc.)
  return (
    <div className="w-full max-w-none">
      <div className="columns-[10rem] sm:columns-[12rem] md:columns-[14rem] lg:columns-[16rem] xl:columns-[18rem] [column-gap:0.5rem]">
        {photos.map((p) => {
          const isSelected = selectedIds.has(p.id);
          const thumbnailSrc = resolveThumbnailSrc(p);
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
                    className="w-5 h-5 rounded border-2 border-white bg-black/50 text-blue-500"
                  />
                </div>
              )}
              {p.isFavorite && (
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
                  className={`w-full h-auto rounded-xl transition-all ${isSelected ? "brightness-75" : ""}`}
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
