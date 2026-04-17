import React, { useState } from "react";
import { SearchFilters, FilterOptions } from "../api";

interface Props {
  open: boolean;
  options: FilterOptions;
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
}

function toggleItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? "bg-blue-600 text-white border-blue-600"
          : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600"
      }`}
    >
      {label}
    </button>
  );
}

export default function FilterDrawer({ open, options, filters, onChange }: Props) {
  const [tagSearch, setTagSearch] = useState("");

  if (!open) return null;

  const visibleTags = tagSearch.trim()
    ? options.tags.filter(t => t.toLowerCase().includes(tagSearch.toLowerCase()))
    : options.tags;

  return (
    <div className="border border-gray-200 rounded-xl bg-white shadow-sm p-4 mt-2 flex flex-col gap-4">

      {/* People */}
      {options.people.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">People</div>
          <div className="flex flex-wrap gap-1.5">
            {options.people.map(name => (
              <Chip
                key={name}
                label={name}
                active={filters.people.includes(name)}
                onClick={() => onChange({ ...filters, people: toggleItem(filters.people, name) })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Date range */}
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Date Range</div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={e => onChange({ ...filters, dateFrom: e.target.value })}
            className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <span className="text-gray-400 text-xs">to</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => onChange({ ...filters, dateTo: e.target.value })}
            className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      </div>

      {/* AI Tags */}
      {options.tags.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            AI Tags {filters.tags.length > 0 && <span className="text-blue-600">({filters.tags.length} selected)</span>}
          </div>
          <input
            type="text"
            placeholder="Search tags…"
            value={tagSearch}
            onChange={e => setTagSearch(e.target.value)}
            className="mb-2 w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {visibleTags.map(tag => (
              <Chip
                key={tag}
                label={tag}
                active={filters.tags.includes(tag)}
                onClick={() => onChange({ ...filters, tags: toggleItem(filters.tags, tag) })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Clear */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onChange({ people: [], dateFrom: '', dateTo: '', tags: [] })}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Clear all filters
        </button>
      </div>
    </div>
  );
}
