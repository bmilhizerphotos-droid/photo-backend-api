import React, { useState } from "react";
import type { Person } from "../api";

interface Props {
  people: Person[];
  onMerge: (sourceId: number, targetId: number) => Promise<void>;
  onCancel: () => void;
}

export function MergePeopleModal({ people, onMerge, onCancel }: Props) {
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const source = sorted.find((p) => p.id === sourceId);
  const target = sorted.find((p) => p.id === targetId);

  const handleMerge = async () => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setSaving(true);
    setError(null);
    try {
      await onMerge(sourceId, targetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
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
        className="bg-white rounded-2xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Merge People</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-500">
            All photos and face data from the source person will move to the target. The source will be deleted.
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Merge FROM (will be deleted)</label>
            <select
              value={sourceId ?? ""}
              onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="">Select person…</option>
              {sorted.filter((p) => p.id !== targetId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.photoCount} photos)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Merge INTO (will keep)</label>
            <select
              value={targetId ?? ""}
              onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="">Select person…</option>
              {sorted.filter((p) => p.id !== sourceId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.photoCount} photos)
                </option>
              ))}
            </select>
          </div>

          {source && target && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">{source.name}</span> ({source.photoCount} photos) will be merged into{" "}
              <span className="font-semibold">{target.name}</span> and permanently deleted.
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-6 pb-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={!sourceId || !targetId || sourceId === targetId || saving}
            className="px-4 py-1.5 text-sm rounded-full bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-40"
          >
            {saving ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
