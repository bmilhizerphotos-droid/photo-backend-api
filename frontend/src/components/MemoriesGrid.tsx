import { useState, useEffect } from 'react';
import { fetchMemories, regenerateMemoriesApi, deleteMemory, Memory } from '../api';
import MemoryEditModal from './MemoryEditModal';

interface MemoriesGridProps {
  onSelectMemory: (memoryId: number) => void;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  if (s.toDateString() === e.toDateString()) {
    return s.toLocaleDateString('en-US', opts);
  }
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${e.getDate()}, ${e.getFullYear()}`;
  }
  return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', opts)}`;
}

export default function MemoriesGrid({ onSelectMemory }: MemoriesGridProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);

  useEffect(() => {
    loadMemories();
  }, []);

  async function loadMemories() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchMemories();
      setMemories(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerate() {
    if (!confirm(
      'This will delete ALL existing memories and regenerate them from scratch using AI.\n\n' +
      'This may take several minutes for large photo libraries.\n\n' +
      'Continue?'
    )) return;

    try {
      setGenerating(true);
      setError(null);
      const result = await regenerateMemoriesApi();
      console.log("Memory regeneration result:", result);
      const refreshed = await fetchMemories();
      setMemories(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate memories');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(memoryId: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this memory? The photos will not be affected.')) return;

    try {
      setDeletingId(memoryId);
      await deleteMemory(memoryId);
      setMemories(prev => prev.filter(m => m.id !== memoryId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete memory');
    } finally {
      setDeletingId(null);
    }
  }

  function handleEdit(memory: Memory, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingMemory(memory);
  }

  function handleEditSaved(updated: Memory) {
    setMemories(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
    setEditingMemory(null);
  }

  if (loading || generating) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        <p className="mt-4 text-gray-500">
          {generating ? 'Regenerating memories with AI...' : 'Loading memories...'}
        </p>
        {generating && (
          <p className="mt-2 text-sm text-gray-400">
            Clustering photos and generating titles, narratives, and tags. This may take several minutes.
          </p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500">
        <p>{error}</p>
        <button
          onClick={loadMemories}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Memories</h2>
        <button
          onClick={handleRegenerate}
          disabled={generating}
          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Regenerate Memories
        </button>
      </div>

      {memories.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-lg">No memories yet</p>
          <p className="text-sm mt-1">Click "Regenerate Memories" to create memories from your photos using AI</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {memories.map(memory => (
            <div
              key={memory.id}
              onClick={() => onSelectMemory(memory.id)}
              className="group relative bg-white rounded-lg shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
            >
              {/* Cover photo */}
              <div className="aspect-[4/3] bg-gray-100 relative">
                {memory.coverPhotoUrl ? (
                  <img
                    src={memory.coverPhotoUrl}
                    alt={memory.title || 'Memory'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}

                {/* Gradient overlay for title readability */}
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />

                {/* Title overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                  <h3 className="font-semibold text-sm leading-tight truncate">
                    {memory.title || 'Untitled Memory'}
                  </h3>
                </div>
              </div>

              {/* Info */}
              <div className="p-3">
                <p className="text-xs text-gray-500">
                  {formatDateRange(memory.eventDateStart, memory.eventDateEnd)}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-400">
                    {memory.photoCount} {memory.photoCount === 1 ? 'photo' : 'photos'}
                  </p>
                  {memory.locationLabel && (
                    <p className="text-xs text-gray-400 truncate ml-2">
                      {memory.locationLabel}
                    </p>
                  )}
                </div>
                {memory.narrative && (
                  <p className="text-xs text-gray-600 mt-2 line-clamp-2">
                    {memory.narrative}
                  </p>
                )}
              </div>

              {/* Edit button */}
              <button
                onClick={(e) => handleEdit(memory, e)}
                className="absolute top-2 right-10 z-10 p-1.5 bg-blue-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>

              {/* Delete button */}
              <button
                onClick={(e) => handleDelete(memory.id, e)}
                disabled={deletingId === memory.id}
                className="absolute top-2 right-2 z-10 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 disabled:opacity-50"
              >
                {deletingId === memory.id ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editingMemory && (
        <MemoryEditModal
          memory={editingMemory}
          onClose={() => setEditingMemory(null)}
          onSaved={handleEditSaved}
        />
      )}
    </div>
  );
}
