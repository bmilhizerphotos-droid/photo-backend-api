import { useState, useEffect, useCallback } from 'react';
import {
  fetchDuplicateStats,
  fetchDuplicates,
  fetchBursts,
  startDuplicateScan,
  DuplicateGroup,
  DuplicateStats,
} from '../api';

type Tab = 'duplicates' | 'bursts';

export default function DuplicatesView() {
  const [stats, setStats] = useState<DuplicateStats | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [bursts, setBursts] = useState<DuplicateGroup[]>([]);
  const [tab, setTab] = useState<Tab>('duplicates');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="p-4">
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

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('duplicates')}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${
            tab === 'duplicates'
              ? 'bg-white text-gray-900 shadow-sm font-medium'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Exact Duplicates ({duplicates.length})
        </button>
        <button
          onClick={() => setTab('bursts')}
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
          {groups.map((group) => (
            <div key={group.groupId} className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${
                    tab === 'duplicates' ? 'bg-red-500' : 'bg-amber-500'
                  }`}>
                    {tab === 'duplicates' ? 'Duplicate' : 'Burst'}
                  </span>
                  <span className="text-sm text-gray-600">
                    {group.count} photos
                  </span>
                </div>
                {group.photos[0]?.dateTaken && (
                  <span className="text-xs text-gray-400">
                    {new Date(group.photos[0].dateTaken).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {group.photos.map((photo, idx) => (
                    <div key={photo.id} className="flex-shrink-0 relative">
                      <img
                        src={photo.thumbnailUrl}
                        alt={photo.filename}
                        className="w-28 h-28 object-cover rounded"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate rounded-b">
                        {photo.filename}
                      </div>
                      {idx === 0 && tab === 'duplicates' && (
                        <div className="absolute top-1 left-1 bg-green-500 text-white text-[9px] font-bold px-1 rounded">
                          ORIGINAL
                        </div>
                      )}
                      {photo.width && photo.height && (
                        <div className="absolute top-1 right-1 bg-black/50 text-white text-[9px] px-1 rounded">
                          {photo.width}x{photo.height}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
