import React, { useEffect } from "react";

interface ImageModalProps {
  imageUrl: string | null;
  onClose: () => void;
}

export function ImageModal({ imageUrl, onClose }: ImageModalProps) {
  // ESC key support — must be before any early return (Rules of Hooks)
  useEffect(() => {
    if (!imageUrl) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <img
        src={imageUrl}
        alt=""
        className="max-w-[95vw] max-h-[95vh] object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        loading="eager"
        decoding="async"
      />
    </div>
  );
}
