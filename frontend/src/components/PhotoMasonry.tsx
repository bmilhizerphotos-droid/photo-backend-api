import React from "react";
import type { Photo } from "../api";

type Props = {
  photos: Photo[];
  onPhotoClick?: (photo: Photo) => void;
};

export function PhotoMasonry({ photos, onPhotoClick }: Props) {
  return (
    <div className="w-full max-w-none">
      <div
        className="
          columns-[10rem] sm:columns-[12rem] md:columns-[14rem] lg:columns-[16rem] xl:columns-[18rem]
          [column-gap:0.5rem]
        "
      >
        {photos.map((p) => (
          <button
            key={String(p.id)}
            type="button"
            onClick={() => onPhotoClick?.(p)}
            className="mb-2 break-inside-avoid block w-full text-left"
          >
            <img
              src={p.thumbnailUrl}
              alt={p.filename ?? ""}
              loading="lazy"
              decoding="async"
              className="w-full h-auto rounded-xl shadow-sm hover:opacity-95 transition"
            />
          </button>
        ))}
      </div>
    </div>
  );
}