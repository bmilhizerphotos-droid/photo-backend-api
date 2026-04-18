import React, { useState } from "react";
import type { PeopleSuggestion, PeopleSuggestionMatch } from "../api";

interface Props {
  suggestions: PeopleSuggestion[];
  loading: boolean;
  onConfirmAll: (suggestion: PeopleSuggestion) => Promise<void>;
  onReview: (suggestion: PeopleSuggestion) => void;
  onRejectAll: (suggestion: PeopleSuggestion) => Promise<void>;
  onExpand: (match: PeopleSuggestionMatch, personName: string) => void;
}

export function MergeSuggestionBar({
  suggestions,
  loading,
  onConfirmAll,
  onReview,
  onRejectAll,
  onExpand,
}: Props) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
        <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-400 rounded-full animate-spin" />
        Analyzing face matches…
      </div>
    );
  }

  if (!suggestions.length) return null;

  const handleConfirmAll = async (suggestion: PeopleSuggestion) => {
    setConfirming(suggestion.person.id);
    try {
      await onConfirmAll(suggestion);
    } finally {
      setConfirming(null);
    }
  };

  const handleRejectAll = async (suggestion: PeopleSuggestion) => {
    setRejecting(suggestion.person.id);
    try {
      await onRejectAll(suggestion);
    } finally {
      setRejecting(null);
    }
  };

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
          Face Suggestions
        </span>
        <span className="text-xs text-gray-400">
          {suggestions.length} possible match{suggestions.length !== 1 ? "es" : ""}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {suggestions.map((s) => {
          const busy = confirming === s.person.id || rejecting === s.person.id;
          return (
            <div
              key={s.person.id}
              className="flex items-center gap-3 bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-2.5"
            >
              {/* Clickable thumbnail strip — opens full photo + face highlight */}
              <div className="flex gap-1 shrink-0">
                {s.matches.slice(0, 4).map((m) => (
                  <button
                    key={m.faceId}
                    onClick={() => onExpand(m, s.person.name)}
                    className="w-10 h-10 rounded-md overflow-hidden border-2 border-yellow-300 hover:border-yellow-500 hover:scale-105 transition-all focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    title="Click to view full photo"
                  >
                    <img
                      src={m.thumbnailUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-800">
                  {s.totalCount} face{s.totalCount !== 1 ? "s" : ""} look like{" "}
                  <span className="font-semibold text-yellow-800">{s.person.name}</span>
                </span>
                <div className="text-xs text-gray-400 mt-0.5">
                  Best match: {(s.matches[0]?.confidence * 100).toFixed(0)}% confidence
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onReview(s)}
                  disabled={busy}
                  className="px-3 py-1 text-xs font-medium rounded-full border border-yellow-400 text-yellow-800 hover:bg-yellow-100 disabled:opacity-50 transition-colors"
                >
                  Review
                </button>
                <button
                  onClick={() => handleConfirmAll(s)}
                  disabled={busy}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-500 hover:bg-yellow-600 text-white disabled:opacity-50 transition-colors"
                >
                  {confirming === s.person.id ? "Saving…" : "Confirm All"}
                </button>
                {/* X = Reject All: persists face IDs to DB so they never resurface */}
                <button
                  onClick={() => handleRejectAll(s)}
                  disabled={busy}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  title={`Not ${s.person.name} — hide these faces permanently`}
                >
                  {rejecting === s.person.id ? (
                    <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
