import React, { useEffect } from "react";

interface FaceBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  imageUrl: string;
  faceBbox: FaceBbox;
  personName: string;
  onClose: () => void;
}

export function FaceExpandModal({ imageUrl, faceBbox, personName, onClose }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white text-2xl leading-none"
        >
          ✕
        </button>

        {/* Person label */}
        <div className="mb-2 text-sm font-medium text-white/80">
          Possible match: <span className="text-amber-400">{personName}</span>
        </div>

        {/* Photo + face box */}
        <div className="relative inline-block max-h-[80vh]">
          <img
            src={imageUrl}
            alt=""
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
            draggable={false}
          />
          {/* Face highlight overlay (percentage-based, matches img rendered size) */}
          <div
            className="absolute border-2 border-amber-400 rounded shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{
              left: `${faceBbox.x * 100}%`,
              top: `${faceBbox.y * 100}%`,
              width: `${faceBbox.width * 100}%`,
              height: `${faceBbox.height * 100}%`,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}
