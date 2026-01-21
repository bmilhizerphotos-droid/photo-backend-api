import React from "react";
import type { Photo } from "../api";

type Props = {
  photos: Photo[];
  onPhotoClick?: (photo: Photo, event?: React.MouseEvent) => void;
  selectedIds?: Set<number>;
  selectMode?: boolean;
};

export function PhotoMasonry({ photos, onPhotoClick, selectedIds = new Set(), selectMode = false }: Props) {
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

          return (
            <div
              key={String(p.id)}
              className="mb-2 break-inside-avoid relative group"
            >
              {/* Selection checkbox overlay */}
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

              {/* Favorite indicator */}
              {isFavorite && (
                <div className="absolute top-2 right-2 z-10">
                  <div className="w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center">
                    <span className="text-xs text-black">★</span>
                  </div>
                </div>
              )}

              {/* Photo button */}
              <button
                type="button"
                onClick={(e) => onPhotoClick?.(p, e)}
                className={`
                  block w-full text-left relative overflow-hidden rounded-xl shadow-sm transition-all
                  ${isSelected
                    ? 'ring-4 ring-blue-500 ring-offset-2 scale-95'
                    : 'hover:opacity-95 hover:scale-105'
                  }
                  ${selectMode ? 'cursor-pointer' : 'cursor-zoom-in'}
                `}
              >
                <img
                  src={p.thumbnailUrl}
                  alt={p.filename ?? ""}
                  loading="lazy"
                  decoding="async"
                  className={`
                    w-full h-auto rounded-xl transition-all
                    ${isSelected ? 'brightness-75' : ''}
                  `}
                />

                {/* Selection overlay */}
                {isSelected && (
                  <div className="absolute inset-0 bg-blue-500/20 rounded-xl" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}