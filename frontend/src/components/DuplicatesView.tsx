import { useState, useEffect, useCallback } from 'react';
import {
  fetchDuplicateStats,
  fetchDuplicates,
  fetchBursts,
  startDuplicateScan,
  softDeletePhotos,
  restorePhotos,
  DuplicateGroup,
  DuplicatePhoto,
  DuplicateStats,
} from '../api';

type Tab = 'duplicates' | 'bursts';

interface ConfirmDialog {
  message: string;
  onConfirm: () => void;
}

export default function DuplicatesView() {
  const [stats, setStats] = useState<DuplicateStats | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [bursts, setBursts] = useState<DuplicateGroup[]>([]);
  const [tab, setTab] = useState<Tab>('duplicates');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set());
  const [pendingRestores, setPendingRestores] = useState<Set<number>>(new Set());

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [s, d, b] = await Promise.all([
        fetchDuplicateStats(),
        fetchDuplicates(),
        fetchBursts(),
      ]);
      setStats(s);
      setScanning(s.scanning);
      setDuplicates(d);
      setBursts(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(async () => {
      try {
        const s = await fetchDuplicateStats();
        setStats(s);
        if (!s.scanning) {
          setScanning(false);
          await loadData();
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [scanning, loadData]);

  async function handleScan() {
    try {
      setScanning(true);
      await startDuplicateScan();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
      setScanning(false);
    }
  }

  function stageDeletePhotoIds(photoIds: number[]) {
    if (photoIds.length === 0) return;
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      photoIds.forEach((id) => next.add(id));
      return next;
    });
    setPendingRestores((prev) => {
      const next = new Set(prev);
      photoIds.forEach((id) => next.delete(id));
      return next;
    });
  }

  function stageRestorePhotoIds(photoIds: number[]) {
    if (photoIds.length === 0) return;
    setPendingRestores((prev) => {
      const next = new Set(prev);
      photoIds.forEach((id) => next.add(id));
      return next;
    });
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      photoIds.forEach((id) => next.delete(id));
      return next;
    });
  }

  function stageDeleteSelected() {
    if (selected.size === 0) return;
    stageDeletePhotoIds(Array.from(selected));
  }

  function stageRestoreSelected() {
    if (selected.size === 0) return;
    stageRestorePhotoIds(Array.from(selected));
  }

  async function applyPendingChanges() {
    setConfirmDialog(null);
    if (pendingDeletes.size === 0 && pendingRestores.size === 0) return;
    setActionLoading(true);
    try {
      if (pendingRestores.size > 0) {
        await restorePhotos(Array.from(pendingRestores));
      }
      if (pendingDeletes.size > 0) {
        await softDeletePhotos(Array.from(pendingDeletes));
      }
      setPendingDeletes(new Set());
      setPendingRestores(new Set());
      setSelected(new Set());
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setActionLoading(false);
    }
  }

  function handleApplyPending() {
    const total = pendingDeletes.size + pendingRestores.size;
    if (total === 0) return;
    setConfirmDialog({
      message: `Apply ${pendingDeletes.size} deletions and ${pendingRestores.size} restores? Photos will only be hidden from the UI and can be brought back later.`,
      onConfirm: applyPendingChanges,
    });
  }

  function handleFeelingLucky() {
    const groupsForTab = tab === 'duplicates' ? duplicates : bursts;
    const toDelete: number[] = [];
    groupsForTab.forEach((group) => {
      const candidates = group.photos.filter((p) => !p.isDeleted);
      if (candidates.length <= 1) return;
      let best = candidates[0];
      let bestScore = (best.width || 0) * (best.height || 0);
      candidates.forEach((photo) => {
        const score = (photo.width || 0) * (photo.height || 0);
        if (score > bestScore) {
          best = photo;
          bestScore = score;
        }
      });
      candidates
        .filter((photo) => photo.id !== best.id)
        .forEach((photo) => toDelete.push(photo.id));
    });
    if (toDelete.length > 0) {
      stageDeletePhotoIds(toDelete);
    }
  }

  function toggleSelect(photoId: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  function stageDeleteSelected() {
    if (selected.size === 0) return;
    stageDeletePhotoIds(Array.from(selected));
  }

  function handleKeepThisOne(group: DuplicateGroup, keepId: number) {
    const toDelete = group.photos.filter(p => p.id !== keepId && !p.isDeleted).map(p => p.id);
    stageDeletePhotoIds(toDelete);
  }

  function handleRestoreGroup(group: DuplicateGroup) {
    const toRestore = group.photos.filter(p => p.isDeleted).map(p => p.id);
    stageRestorePhotoIds(toRestore);
  }

  function handleRestoreSelected() {
    const selectedDeleted = Array.from(selected).filter(id => {
      const groups = tab === 'duplicates' ? duplicates : bursts;
      for (const g of groups) {
        const photo = g.photos.find(p => p.id === id);
        if (photo?.isDeleted) return true;
      }
      return false;
    });
    if (selectedDeleted.length === 0) return;
    stageRestorePhotoIds(selectedDeleted);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
        <p className="mt-4 text-gray-500">Loading duplicate data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500">
        <p>{error}</p>
        <button onClick={loadData} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          Retry
        </button>
      </div>
    );
  }

  const groups = tab === 'duplicates' ? duplicates : bursts;

  const selectedCount = selected.size;
  const hasDeletedInSelection = Array.from(selected).some(id => {
    for (const g of groups) {
      const photo = g.photos.find(p => p.id === id);
      if (photo?.isDeleted) return true;
    }
    return false;
  });
  const hasActiveInSelection = Array.from(selected).some(id => {
    for (const g of groups) {
      const photo = g.photos.find(p => p.id === id && !p.isDeleted);
      if (photo) return true;
    }
    return false;
  });

  return (
    <div className="p-4">
      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
            <p className="text-gray-800 mb-4">{confirmDialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-800">Duplicates & Bursts</h2>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
        >
          {scanning ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Scanning...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Scan for Duplicates
            </>
          )}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-lg border p-3">
            <p className="text-xs text-gray-500 uppercase">Total Photos</p>
            <p className="text-xl font-bold text-gray-800">{stats.totalPhotos.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <p className="text-xs text-gray-500 uppercase">Hashed</p>
            <p className="text-xl font-bold text-gray-800">{stats.hashedPhotos.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <p className="text-xs text-gray-500 uppercase">Duplicate Groups</p>
            <p className="text-xl font-bold text-red-600">{stats.duplicateGroups.toLocaleString()}</p>
            <p className="text-xs text-gray-400">{stats.duplicatePhotos.toLocaleString()} photos</p>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <p className="text-xs text-gray-500 uppercase">Burst Groups</p>
            <p className="text-xl font-bold text-amber-600">{stats.burstGroups.toLocaleString()}</p>
            <p className="text-xs text-gray-400">{stats.burstPhotos.toLocaleString()} photos</p>
          </div>
        </div>
      )}

      {scanning && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
          <div>
            <p className="text-sm font-medium text-blue-800">Scanning in progress...</p>
            <p className="text-xs text-blue-600">
              Hashing files and grouping duplicates. This may take a while for large libraries.
              Results will update automatically.
            </p>
          </div>
        </div>
      )}

      {/* Selection action bar */}
      {selectedCount > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-blue-800">{selectedCount} selected</span>
          <button
            onClick={stageDeleteSelected}
            disabled={!hasActiveInSelection || actionLoading}
            className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 disabled:opacity-50"
          >
            Stage Delete
          </button>
          <button
            onClick={stageRestoreSelected}
            disabled={!hasDeletedInSelection || actionLoading}
            className="px-3 py-1.5 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 disabled:opacity-50"
          >
            Stage Restore
          </button>
          <button
            onClick={handleFeelingLucky}
            disabled={groups.length === 0 || actionLoading}
            className="px-3 py-1.5 bg-purple-500 text-white text-sm rounded-lg hover:bg-purple-600 disabled:opacity-50"
          >
            Feeling lucky
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 text-gray-600 text-sm border border-gray-300 rounded-lg hover:bg-gray-100"
          >
            Clear Selection
          </button>
        </div>
      )}
      {(pendingDeletes.size + pendingRestores.size) > 0 && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg flex flex-wrap items-center gap-3">
          <button
            onClick={handleApplyPending}
            disabled={actionLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Apply staged changes
          </button>
          <button
            onClick={() => {
              setPendingDeletes(new Set());
              setPendingRestores(new Set());
            }}
            className="px-3 py-1.5 text-gray-600 text-sm border border-gray-300 rounded-lg hover:bg-gray-100"
          >
            Clear staging
          </button>
          <span className="text-xs text-gray-500">
            Pending: {pendingDeletes.size} delete{pendingDeletes.size !== 1 ? 's' : ''}, {pendingRestores.size} restore{pendingRestores.size !== 1 ? 's' : ''}. Soft deletes only hide photos from the UI.
          </span>
        </div>
      )}

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => { setTab('duplicates'); setSelected(new Set()); }}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${
            tab === 'duplicates'
              ? 'bg-white text-gray-900 shadow-sm font-medium'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Exact Duplicates ({duplicates.length})
        </button>
        <button
          onClick={() => { setTab('bursts'); setSelected(new Set()); }}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${
            tab === 'bursts'
              ? 'bg-white text-gray-900 shadow-sm font-medium'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Burst Shots ({bursts.length})
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-lg">
            {tab === 'duplicates' ? 'No exact duplicates found' : 'No burst groups found'}
          </p>
          <p className="text-sm mt-1">
            {stats && stats.hashedPhotos === 0
              ? 'Click "Scan for Duplicates" to analyze your photos.'
              : tab === 'duplicates'
              ? 'All your photos appear to be unique.'
              : 'No burst sequences detected.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const hasDeleted = group.photos.some(p => p.isDeleted);
            const allDeleted = group.photos.every(p => p.isDeleted);
            return (
              <div key={group.groupId} className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${
                      tab === 'duplicates' ? 'bg-red-500' : 'bg-amber-500'
                    }`}>
                      {tab === 'duplicates' ? 'Duplicate' : 'Burst'}
                    </span>
                    <span className="text-sm text-gray-600">
                      {group.count} photos
                    </span>
                    {hasDeleted && (
                      <span className="text-xs text-gray-400">
                        ({group.photos.filter(p => p.isDeleted).length} deleted)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {group.photos[0]?.dateTaken && (
                      <span className="text-xs text-gray-400">
                        {new Date(group.photos[0].dateTaken).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </span>
                    )}
                    {hasDeleted && !allDeleted && (
                      <button
                        onClick={() => handleRestoreGroup(group)}
                        disabled={actionLoading}
                        className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50"
                      >
                        Restore All
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {group.photos.map((photo, idx) => (
                      <PhotoCard
                        key={photo.id}
                        photo={photo}
                        idx={idx}
                        tab={tab}
                        isSelected={selected.has(photo.id)}
                        onToggleSelect={() => toggleSelect(photo.id)}
                        onKeepThisOne={() => handleKeepThisOne(group, photo.id)}
                        actionLoading={actionLoading}
                        pendingStatus={
                          pendingDeletes.has(photo.id)
                            ? 'delete'
                            : pendingRestores.has(photo.id)
                              ? 'restore'
                              : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PhotoCard({
  photo,
  idx,
  tab,
  isSelected,
  onToggleSelect,
  onKeepThisOne,
  actionLoading,
  pendingStatus,
}: {
  photo: DuplicatePhoto;
  idx: number;
  tab: Tab;
  isSelected: boolean;
  onToggleSelect: () => void;
  onKeepThisOne: () => void;
  actionLoading: boolean;
  pendingStatus?: 'delete' | 'restore';
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`flex-shrink-0 relative group ${photo.isDeleted ? 'opacity-40' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={photo.thumbnailUrl}
        alt={photo.filename}
        className={`w-28 h-28 object-cover rounded ${
          isSelected ? 'ring-2 ring-blue-500' : ''
        } ${photo.isDeleted ? 'grayscale' : ''}`}
      />
      {/* Filename overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate rounded-b">
        {photo.filename}
      </div>
      {/* Original badge (first in duplicates tab) */}
      {idx === 0 && tab === 'duplicates' && !photo.isDeleted && (
        <div className="absolute top-1 left-1 bg-green-500 text-white text-[9px] font-bold px-1 rounded">
          ORIGINAL
        </div>
      )}
      {/* Deleted badge */}
      {photo.isDeleted && (
        <div className="absolute top-1 left-1 bg-red-500 text-white text-[9px] font-bold px-1 rounded">
          DELETED
        </div>
      )}
      {/* Resolution badge */}
      {photo.width && photo.height && (
        <div className="absolute top-1 right-1 bg-black/50 text-white text-[9px] px-1 rounded">
          {photo.width}x{photo.height}
        </div>
      )}
      {/* Pending action badge */}
      {pendingStatus && (
        <div
          className={`absolute top-8 right-1 text-[9px] font-semibold px-2 py-0.5 rounded ${
            pendingStatus === 'delete' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
          }`}
        >
          {pendingStatus === 'delete' ? 'Staged delete' : 'Staged restore'}
        </div>
      )}
      {/* Checkbox */}
      <label
        className={`absolute top-7 left-1 cursor-pointer ${
          hovered || isSelected ? 'opacity-100' : 'opacity-0'
        } transition-opacity`}
        onClick={e => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
        />
      </label>
      {/* Keep this one button on hover */}
      {hovered && !photo.isDeleted && (
        <button
          onClick={(e) => { e.stopPropagation(); onKeepThisOne(); }}
          disabled={actionLoading}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[10px] px-2 py-0.5 rounded shadow whitespace-nowrap hover:bg-green-700 disabled:opacity-50"
        >
          Keep this one
        </button>
      )}
    </div>
  );
}
