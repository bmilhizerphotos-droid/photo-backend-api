import { useState, useEffect } from 'react';
import { fetchMemory, updateMemory, generateMemoryNarrative, Photo, Memory } from '../api';

interface MemoryEditModalProps {
  memory: Memory;
  onClose: () => void;
  onSaved: (updated: Memory) => void;
}

export default function MemoryEditModal({ memory, onClose, onSaved }: MemoryEditModalProps) {
  const [title, setTitle] = useState(memory.title || '');
  const [narrative, setNarrative] = useState(memory.narrative || '');
  const [locationLabel, setLocationLabel] = useState(memory.locationLabel || '');
  const [coverPhotoId, setCoverPhotoId] = useState<number | null>(memory.coverPhotoId);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const full = await fetchMemory(memory.id);
        if (!cancelled) setPhotos(full.photos);
      } catch {
        if (!cancelled) setError('Failed to load photos');
      } finally {
        if (!cancelled) setPhotosLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memory.id]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateMemoryNarrative(memory.id);
      if (result.title) setTitle(result.title);
      if (result.narrative) setNarrative(result.narrative);
      if (result.locationLabel) setLocationLabel(result.locationLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updates: Record<string, string | number | null> = {};
      if (title.trim() !== (memory.title || '')) updates.title = title.trim();
      if (narrative.trim() !== (memory.narrative || '')) updates.narrative = narrative.trim() || null;
      if (locationLabel.trim() !== (memory.locationLabel || '')) updates.locationLabel = locationLabel.trim() || null;
      if (coverPhotoId !== memory.coverPhotoId) updates.coverPhotoId = coverPhotoId;

      if (Object.keys(updates).length === 0) {
        onClose();
        return;
      }

      await updateMemory(memory.id, updates);

      onSaved({
        ...memory,
        title: title.trim() || memory.title,
        narrative: narrative.trim() || null,
        locationLabel: locationLabel.trim() || null,
        coverPhotoId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-800">Edit Memory</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* AI Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating || saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:opacity-50"
          >
            {generating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate with AI
              </>
            )}
          </button>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
            />
          </div>

          {/* Narrative */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Narrative</label>
            <textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={4}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 resize-vertical"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              type="text"
              value={locationLabel}
              onChange={(e) => setLocationLabel(e.target.value)}
              placeholder="Add location"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
            />
          </div>

          {/* Cover photo selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cover Photo</label>
            {photosLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                Loading photos...
              </div>
            ) : photos.length === 0 ? (
              <p className="text-sm text-gray-400">No photos in this memory.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                {photos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setCoverPhotoId(photo.id)}
                    className={`aspect-square rounded overflow-hidden border-2 transition-colors ${
                      coverPhotoId === photo.id
                        ? 'border-blue-500 ring-2 ring-blue-300'
                        : 'border-transparent hover:border-gray-300'
                    }`}
                  >
                    <img
                      src={photo.thumbnailUrl}
                      alt={photo.filename}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || generating || !title.trim()}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
