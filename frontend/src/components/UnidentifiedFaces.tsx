import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  FaceCluster,
  FaceClusterMatch,
  ClusterConfirmTarget,
  fetchFaceClusters,
  confirmFaceCluster,
  rejectFaceCluster,
  fetchPeople,
  searchPeople,
  Person,
} from "../api";
import { FaceExpandModal } from "./FaceExpandModal";

interface UnidentifiedFacesProps {
  onBack: () => void;
}

// ── Person selection state ────────────────────────────────────────────────────
type PersonSelection =
  | { type: "existing"; person: Person }
  | { type: "new"; name: string }
  | null;

function selectionToTarget(s: PersonSelection): ClusterConfirmTarget | null {
  if (!s) return null;
  return s.type === "existing" ? { personId: s.person.id } : { name: s.name };
}

// ── Inline searchable combo-box ───────────────────────────────────────────────
function PersonComboBox({
  value,
  onChange,
}: {
  value: PersonSelection;
  onChange: (v: PersonSelection) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced search
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = query.trim() ? await searchPeople(query) : await fetchPeople();
        setResults(data.slice(0, 8));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [query]);

  const trimmed = query.trim();
  const exactMatch = results.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  const showAdd = trimmed.length >= 2 && !exactMatch;

  type DropItem =
    | { kind: "add"; name: string }
    | { kind: "person"; person: Person };

  const items: DropItem[] = [
    ...(showAdd ? [{ kind: "add" as const, name: trimmed }] : []),
    ...results.map((p) => ({ kind: "person" as const, person: p })),
  ];

  const commit = (sel: PersonSelection) => {
    onChange(sel);
    setOpen(false);
    setQuery("");
    setActiveIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const it = items[activeIdx];
      commit(it.kind === "person" ? { type: "existing", person: it.person } : { type: "new", name: it.name });
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Selected chip
  if (value) {
    return (
      <div className="inline-flex items-center gap-1.5 h-8 px-2.5 bg-yellow-100 border border-yellow-400 rounded-lg text-sm max-w-[200px]">
        {value.type === "existing" && value.person.thumbnailUrl && (
          <img src={value.person.thumbnailUrl} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
        )}
        <span className="font-medium text-yellow-900 truncate">
          {value.type === "existing" ? value.person.name : value.name}
        </span>
        {value.type === "new" && (
          <span className="text-[10px] text-yellow-600 bg-yellow-200 px-1 rounded shrink-0">New</span>
        )}
        <button
          onClick={() => onChange(null)}
          className="ml-0.5 text-yellow-500 hover:text-yellow-900 shrink-0"
          title="Clear"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search or add name…"
        className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent w-48"
      />

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-xl shadow-xl border border-gray-200 z-50 max-h-60 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-5">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-yellow-500 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* "Add new" option */}
              {showAdd && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); commit({ type: "new", name: trimmed }); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-gray-100 transition-colors ${
                    activeIdx === 0 ? "bg-yellow-50" : "hover:bg-yellow-50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600 shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-yellow-700">Add "{trimmed}"</div>
                    <div className="text-xs text-gray-400">Create as new person</div>
                  </div>
                </button>
              )}

              {/* Existing people */}
              {results.length === 0 && !showAdd ? (
                <div className="py-6 text-center text-sm text-gray-400">
                  {query ? "No people found" : "No people yet"}
                </div>
              ) : (
                results.map((person, idx) => {
                  const itemIdx = showAdd ? idx + 1 : idx;
                  return (
                    <button
                      key={person.id}
                      onMouseDown={(e) => { e.preventDefault(); commit({ type: "existing", person }); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        activeIdx === itemIdx ? "bg-gray-100" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden shrink-0">
                        {person.thumbnailUrl ? (
                          <img src={person.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{person.name}</div>
                        <div className="text-xs text-gray-400">{person.photoCount} photo{person.photoCount !== 1 ? "s" : ""}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Cluster review modal ──────────────────────────────────────────────────────
function ClusterReviewModal({
  cluster,
  selection,
  onConfirm,
  onCancel,
}: {
  cluster: FaceCluster;
  selection: PersonSelection;
  onConfirm: (faceIds: number[], photoIds: number[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    new Set(cluster.matches.map((m) => m.faceId))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const toggle = (faceId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(faceId) ? next.delete(faceId) : next.add(faceId);
      return next;
    });

  const handleConfirm = async () => {
    if (!selected.size) return;
    setSaving(true);
    try {
      const sel = cluster.matches.filter((m) => selected.has(m.faceId));
      await onConfirm(
        sel.map((m) => m.faceId),
        [...new Set(sel.map((m) => m.photoId))]
      );
    } finally {
      setSaving(false);
    }
  };

  const label = !selection
    ? "no name selected"
    : selection.type === "existing"
    ? `"${selection.person.name}"`
    : `"${selection.name}" (new)`;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Review cluster — tagging as <span className="text-yellow-700">{label}</span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {selected.size} of {cluster.matches.length} selected
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-4">
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {cluster.matches.map((m) => {
              const isSel = selected.has(m.faceId);
              return (
                <button
                  key={m.faceId}
                  onClick={() => toggle(m.faceId)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    isSel
                      ? "border-yellow-500 ring-2 ring-yellow-300"
                      : "border-transparent opacity-50 grayscale"
                  }`}
                >
                  <img src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute bottom-1 right-1 bg-black/60 rounded px-1 py-0.5 text-[10px] text-white font-mono">
                    {(m.confidence * 100).toFixed(0)}%
                  </div>
                  {isSel && (
                    <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-white text-[10px] font-bold">
                      ✓
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-3 border-t flex items-center justify-between shrink-0 bg-gray-50 rounded-b-2xl">
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set(cluster.matches.map((m) => m.faceId)))}
              className="text-xs text-blue-600 hover:underline"
            >
              Select all
            </button>
            <span className="text-gray-300">|</span>
            <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:underline">
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
              disabled={saving || !selected.size || !selection}
              className="px-4 py-1.5 text-sm rounded-full bg-yellow-500 hover:bg-yellow-600 text-white font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : `Confirm ${selected.size}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Cluster row ───────────────────────────────────────────────────────────────
interface ClusterRowProps {
  cluster: FaceCluster;
  onConfirm: (cluster: FaceCluster, target: ClusterConfirmTarget, faceIds: number[], photoIds: number[]) => Promise<void>;
  onReject: (cluster: FaceCluster) => Promise<void>;
  onExpand: (match: FaceClusterMatch) => void;
}

function ClusterRow({ cluster, onConfirm, onReject, onExpand }: ClusterRowProps) {
  const [selection, setSelection] = useState<PersonSelection>(null);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [selError, setSelError] = useState(false);

  const allFaceIds = cluster.matches.map((m) => m.faceId);
  const allPhotoIds = [...new Set(cluster.matches.map((m) => m.photoId))];
  const busy = confirming || rejecting;

  const handleConfirmAll = async () => {
    const target = selectionToTarget(selection);
    if (!target) { setSelError(true); return; }
    setSelError(false);
    setConfirming(true);
    try {
      await onConfirm(cluster, target, allFaceIds, allPhotoIds);
    } finally {
      setConfirming(false);
    }
  };

  const handleReject = async () => {
    setRejecting(true);
    try {
      await onReject(cluster);
    } finally {
      setRejecting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3">
        {/* Thumbnail strip */}
        <div className="flex gap-1 shrink-0">
          {cluster.matches.slice(0, 5).map((m) => (
            <button
              key={m.faceId}
              onClick={() => onExpand(m)}
              className="w-10 h-10 rounded-md overflow-hidden border-2 border-yellow-300 hover:border-yellow-500 hover:scale-105 transition-all focus:outline-none focus:ring-2 focus:ring-yellow-400"
              title="Click to view full photo"
            >
              <img src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
          {cluster.size > 5 && (
            <div className="w-10 h-10 rounded-md border-2 border-yellow-200 bg-yellow-100 flex items-center justify-center text-xs text-yellow-700 font-medium">
              +{cluster.size - 5}
            </div>
          )}
        </div>

        {/* Cluster info */}
        <div className="shrink-0 w-40">
          <div className="text-sm font-medium text-gray-800 leading-tight">
            {cluster.size} face{cluster.size !== 1 ? "s" : ""} — same person?
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {(cluster.matches[0]?.confidence * 100).toFixed(0)}% best match
          </div>
        </div>

        {/* Combo-box + error */}
        <div className="flex-1 flex flex-col gap-0.5 min-w-0">
          <PersonComboBox
            value={selection}
            onChange={(v) => { setSelection(v); setSelError(false); }}
          />
          {selError && (
            <span className="text-xs text-red-500">Select or create a person first</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setReviewing(true)}
            disabled={busy}
            className="px-3 py-1 text-xs font-medium rounded-full border border-yellow-400 text-yellow-800 hover:bg-yellow-100 disabled:opacity-50 transition-colors"
          >
            Review
          </button>
          <button
            onClick={handleConfirmAll}
            disabled={busy}
            className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-500 hover:bg-yellow-600 text-white disabled:opacity-50 transition-colors"
          >
            {confirming ? "Saving…" : "Confirm All"}
          </button>
          <button
            onClick={handleReject}
            disabled={busy}
            className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
            title="Skip — never show this cluster again"
          >
            {rejecting ? (
              <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {reviewing && (
        <ClusterReviewModal
          cluster={cluster}
          selection={selection}
          onConfirm={async (faceIds, photoIds) => {
            const target = selectionToTarget(selection);
            if (!target) return;
            await onConfirm(cluster, target, faceIds, photoIds);
            setReviewing(false);
          }}
          onCancel={() => setReviewing(false)}
        />
      )}
    </>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export function UnidentifiedFaces({ onBack }: UnidentifiedFacesProps) {
  const [clusters, setClusters] = useState<FaceCluster[]>([]);
  const [totalClusters, setTotalClusters] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandMatch, setExpandMatch] = useState<FaceClusterMatch | null>(null);
  const initialized = useRef(false);
  const LIMIT = 10;

  const loadClusters = useCallback(async (pageNum: number, append: boolean, forceRefresh = false) => {
    pageNum === 0 ? setLoading(true) : setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchFaceClusters(pageNum, LIMIT, forceRefresh);
      setClusters((prev) => (append ? [...prev, ...data.clusters] : data.clusters));
      setTotalClusters(data.totalClusters);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clusters");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadClusters(0, false, false);
    }
  }, [loadClusters]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    loadClusters(next, true, false);
  };

  const handleRecompute = () => {
    setPage(0);
    setClusters([]);
    initialized.current = true;
    loadClusters(0, false, true);
  };

  const handleConfirm = useCallback(async (
    cluster: FaceCluster,
    target: ClusterConfirmTarget,
    faceIds: number[],
    photoIds: number[]
  ) => {
    await confirmFaceCluster(target, faceIds, photoIds);
    setClusters((prev) => prev.filter((c) => c.clusterId !== cluster.clusterId));
    setTotalClusters((t) => Math.max(0, t - 1));
  }, []);

  const handleReject = useCallback(async (cluster: FaceCluster) => {
    await rejectFaceCluster(cluster.matches.map((m) => m.faceId));
    setClusters((prev) => prev.filter((c) => c.clusterId !== cluster.clusterId));
    setTotalClusters((t) => Math.max(0, t - 1));
  }, []);

  const hasMore = clusters.length < totalClusters;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to People
          </button>
          <h2 className="text-xl font-bold text-gray-900">Unidentified Face Clusters</h2>
        </div>
        <div className="flex items-center gap-3">
          {!loading && totalClusters > 0 && (
            <span className="text-sm text-gray-500">
              {totalClusters} cluster{totalClusters !== 1 ? "s" : ""} found
            </span>
          )}
          <button
            onClick={handleRecompute}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            Recompute
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={handleRecompute} className="text-sm text-red-600 hover:text-red-800 underline ml-4">
            Retry
          </button>
        </div>
      )}

      {/* States */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-yellow-500 rounded-full animate-spin mb-3" />
          <p className="text-sm">Clustering faces… this may take a moment</p>
          <p className="text-xs mt-1 text-gray-300">Analyzing up to 3,000 face embeddings at 90% similarity</p>
        </div>
      ) : clusters.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-5xl mb-4">🎉</div>
          <h3 className="text-lg font-medium mb-2">No clusters found</h3>
          <p className="text-sm">No unidentified face groups found at 90% similarity.</p>
          <button onClick={handleRecompute} className="mt-4 text-sm text-blue-600 hover:underline">
            Recompute
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 mb-6">
            {clusters.map((c) => (
              <ClusterRow
                key={c.clusterId}
                cluster={c}
                onConfirm={handleConfirm}
                onReject={handleReject}
                onExpand={setExpandMatch}
              />
            ))}
          </div>

          {hasMore && (
            <div className="text-center pb-6">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-6 py-2 rounded-full bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                {loadingMore ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Loading…
                  </>
                ) : (
                  `Load More (${clusters.length} of ${totalClusters} shown)`
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Face expand modal */}
      {expandMatch && (
        <FaceExpandModal
          imageUrl={expandMatch.thumbnailUrl.replace(/\/thumbnails\/(\d+)/, "/api/photos/$1/file")}
          faceBbox={expandMatch.faceBbox}
          personName="Unidentified"
          onClose={() => setExpandMatch(null)}
        />
      )}
    </div>
  );
}
