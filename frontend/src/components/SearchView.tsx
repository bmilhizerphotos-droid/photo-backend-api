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
        <span className="text-sm">Searching…</span>
      </div>
    );
  }

  // Build chips from meta.
  // Person chip (violet) → comes from people.name match.
  // Keyword chips (blue) → all remaining text tokens.
  // Date chip (amber) → parsed date range.
  const chips: { label: string; removeTerm: string; color: string }[] = [];

  if (meta?.personName) {
    chips.push({
      label: `👤 ${meta.personName}`,
      removeTerm: meta.personName.split(" ")[0].toLowerCase(),
      color: "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100",
    });
  }

  for (const kw of meta?.contextKeywords ?? []) {
    chips.push({
      label: kw,
      removeTerm: kw,
      color: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
    });
  }

  if (meta?.dateRange) {
    const { start, end } = meta.dateRange;
    const label =
      start.slice(0, 7) === end.slice(0, 7)
        ? `📅 ${start.slice(0, 7)}`
        : `📅 ${start.slice(0, 7)} – ${end.slice(0, 7)}`;
    chips.push({
      label,
      removeTerm: start.slice(0, 4),
      color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
    });
  }

  const resultCount = results.length;
  const hasResults = resultCount > 0;

  return (
    <div>
      {/* Header: count + AND chips */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-sm text-gray-500 shrink-0">
          {hasMore ? `${resultCount}+` : resultCount}{" "}
          {resultCount === 1 ? "result" : "results"}
          {query && (
            <span className="ml-1 text-gray-400">
              — AND logic across all terms
            </span>
          )}
        </span>

        {chips.map((chip) => (
          <span
            key={chip.label}
            className={`inline-flex items-center gap-1 text-xs border rounded-full px-2.5 py-0.5 transition-colors ${chip.color}`}
          >
            {chip.label}
            <button
              onClick={() => onRemoveTerm(chip.removeTerm)}
              className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity leading-none text-base"
              aria-label={`Remove filter: ${chip.label}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Empty state */}
      {!hasResults && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
          <span className="text-4xl">🔍</span>
          <p className="text-sm font-medium">No photos matched all terms</p>
          <p className="text-xs text-gray-400">
            Every word must appear somewhere in the photo's metadata.
            Try removing a chip above to broaden the search.
          </p>
        </div>
      )}

      {/* Results grid */}
      {hasResults && (
        <PhotoMasonry photos={results} onPhotoClick={onPhotoClick} />
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-10" />
      {loadingMore && (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
