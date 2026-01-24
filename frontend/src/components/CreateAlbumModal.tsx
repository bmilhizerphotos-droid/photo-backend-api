// FILE: frontend/src/components/CreateAlbumModal.tsx
import { useState, useEffect, useRef } from 'react';
import { createAlbum, updateAlbum, Album } from '../api';

interface CreateAlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (album: Album) => void;
  editAlbum?: Album | null; // If provided, edit mode
}

export default function CreateAlbumModal({ isOpen, onClose, onCreated, editAlbum }: CreateAlbumModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isEditMode = !!editAlbum;

  useEffect(() => {
    if (isOpen) {
      if (editAlbum) {
        setName(editAlbum.name);
        setDescription(editAlbum.description || '');
      } else {
        setName('');
        setDescription('');
      }
      setError(null);
      // Focus input after modal opens
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, editAlbum]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      setError('Album name is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      if (isEditMode && editAlbum) {
        await updateAlbum(editAlbum.id, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
        onCreated({
          ...editAlbum,
          name: name.trim(),
          description: description.trim() || null,
        });
      } else {
        const newAlbum = await createAlbum(name.trim(), description.trim() || undefined);
        onCreated(newAlbum);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save album');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">
          {isEditMode ? 'Edit Album' : 'Create New Album'}
        </h2>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="album-name" className="block text-sm font-medium text-gray-700 mb-1">
              Album Name *
            </label>
            <input
              ref={inputRef}
              id="album-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter album name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              disabled={saving}
            />
          </div>

          <div className="mb-4">
            <label htmlFor="album-desc" className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              id="album-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              disabled={saving}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {isEditMode ? 'Save Changes' : 'Create Album'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
