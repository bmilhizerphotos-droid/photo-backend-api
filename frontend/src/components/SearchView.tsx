import { RefObject } from "react";
import { Photo, SearchMeta } from "../api";
import { PhotoMasonry } from "./PhotoMasonry";

interface Props {
  query: string;
  meta: SearchMeta | null;
  results: Photo[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  sentinelRef: RefObject<HTMLDivElement>;
  onPhotoClick: (p: Photo) => void;
  onRemoveTerm: (term: string) => void;
}

export default function SearchView({
  query,
  meta,
  results,
  loading,
  loadingMore,
  hasMore,
  sentinelRef,
  onPhotoClick,
  onRemoveTerm,
}: Props) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-sm">Searching with AI…</span>
      </div>
    );
  }

  // Build chips from meta
  const chips: { label: string; term: string; color: string }[] = [];
  if (meta?.personName) {
    chips.push({
      label: `👤 ${meta.personName}`,
      term: meta.personName.split(" ")[0].toLowerCase(),
      color: "bg-violet-50 text-violet-700 border-violet-200",
    });
  }
  for (const kw of meta?.contextKeywords ?? []) {
    chips.push({
      label: kw,
      term: kw,
      color: "bg-blue-50 text-blue-700 border-blue-200",
    });
  }
  if (meta?.dateRange) {
    const { start, end } = meta.dateRange;
    chips.push({
      label: `📅 ${start.slice(0, 7)} – ${end.slice(0, 7)}`,
      term: start.slice(0, 4),
      color: "bg-amber-50 text-amber-700 border-amber-200",
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-sm text-gray-500">
          {results.length}{hasMore ? "+" : ""} result{results.length !== 1 ? "s" : ""}
          {query && <span className="ml-1 text-gray-400">for "{query}"</span>}
        </span>

        {chips.map((chip) => (
          <span
            key={chip.label}
            className={`inline-flex items-center gap-1 text-xs border rounded-full px-2.5 py-0.5 ${chip.color}`}
          >
            {chip.label}
            <button
              onClick={() => onRemoveTerm(chip.term)}
              className="ml-0.5 hover:opacity-60 transition-opacity leading-none"
              aria-label={`Remove ${chip.label}`}
            >
              ×
            </button>
          </span>
        ))}

        {results.length === 0 && (
          <span className="text-sm text-gray-400">No photos found — try different words</span>
        )}
      </div>

      <PhotoMasonry photos={results} onPhotoClick={onPhotoClick} />

      <div ref={sentinelRef} className="h-10" />
      {loadingMore && (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
