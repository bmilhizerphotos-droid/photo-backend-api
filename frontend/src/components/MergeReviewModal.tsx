import React, { useState } from "react";
import type { PeopleSuggestion } from "../api";

interface Props {
  suggestion: PeopleSuggestion;
  onConfirm: (photoIds: number[]) => Promise<void>;
  onCancel: () => void;
}

export function MergeReviewModal({ suggestion, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<Set<number>>(
    new Set(suggestion.matches.map((m) => m.photoId))
  );
  const [saving, setSaving] = useState(false);

  const toggle = (photoId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(photoId) ? next.delete(photoId) : next.add(photoId);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!selected.size) return;
    setSaving(true);
    try {
      await onConfirm(Array.from(selected));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Review matches for{" "}
              <span className="text-amber-700">{suggestion.person.name}</span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {selected.size} of {suggestion.matches.length} selected
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            ✕
          </button>
        </div>

        {/* Thumbnail grid */}
        <div className="overflow-y-auto flex-1 p-4">
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {suggestion.matches.map((m) => {
              const isSelected = selected.has(m.photoId);
              return (
                <button
                  key={m.photoId}
                  onClick={() => toggle(m.photoId)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    isSelected
                      ? "border-amber-500 ring-2 ring-amber-300"
                      : "border-transparent opacity-50 grayscale"
                  }`}
                >
                  <img
                    src={m.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute bottom-1 right-1 bg-black/60 rounded px-1 py-0.5 text-[10px] text-white font-mono">
                    {(m.confidence * 100).toFixed(0)}%
                  </div>
                  {isSelected && (
                    <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-white text-[10px] font-bold">
                      ✓
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex items-center justify-between shrink-0 bg-gray-50 rounded-b-2xl">
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set(suggestion.matches.map((m) => m.photoId)))}
              className="text-xs text-blue-600 hover:underline"
            >
              Select all
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-gray-500 hover:underline"
            >
              Clear
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-sm rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || !selected.size}
              className="px-4 py-1.5 text-sm rounded-full bg-amber-500 hover:bg-amber-600 text-white font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : `Confirm ${selected.size} photo${selected.size !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
