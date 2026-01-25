// FILE: frontend/src/components/AddToAlbumModal.tsx
import { useState, useEffect } from 'react';
import { fetchAlbums, addPhotosToAlbum, createAlbum, Album } from '../api';

interface AddToAlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  photoIds: number[];
  onAdded: (albumId: number, albumName: string) => void;
}

export default function AddToAlbumModal({ isOpen, onClose, photoIds, onAdded }: AddToAlbumModalProps) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadAlbums();
      setSelectedAlbumId(null);
      setShowCreateNew(false);
      setNewAlbumName('');
      setError(null);
    }
  }, [isOpen]);

  async function loadAlbums() {
    try {
      setLoading(true);
      const data = await fetchAlbums();
      setAlbums(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load albums');
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!selectedAlbumId) return;

    try {
      setSaving(true);
      setError(null);
      await addPhotosToAlbum(selectedAlbumId, photoIds);
      const album = albums.find(a => a.id === selectedAlbumId);
      onAdded(selectedAlbumId, album?.name || 'Album');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add photos to album');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAndAdd() {
    if (!newAlbumName.trim()) return;

    try {
      setSaving(true);
      setError(null);

      // Create the album
      const newAlbum = await createAlbum(newAlbumName.trim());

      // Add photos to it
      await addPhotosToAlbum(newAlbum.id, photoIds);

      onAdded(newAlbum.id, newAlbum.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create album');
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
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-xl font-bold text-gray-800">
            Add to Album
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {photoIds.length} {photoIds.length === 1 ? 'photo' : 'photos'} selected
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          ) : (
            <>
              {/* Create new album option */}
              <button
                onClick={() => setShowCreateNew(!showCreateNew)}
                className="w-full mb-3 p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-500 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create New Album
              </button>

              {showCreateNew && (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="text"
                    value={newAlbumName}
                    onChange={(e) => setNewAlbumName(e.target.value)}
                    placeholder="Album name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleCreateAndAdd}
                    disabled={!newAlbumName.trim() || saving}
                    className="mt-2 w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {saving && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    Create & Add Photos
                  </button>
                </div>
              )}

              {/* Existing albums list */}
              {albums.length > 0 ? (
                <div className="space-y-2">
                  {albums.map(album => (
                    <button
                      key={album.id}
                      onClick={() => setSelectedAlbumId(album.id)}
                      className={`w-full p-3 rounded-lg border-2 transition-colors flex items-center gap-3 text-left ${
                        selectedAlbumId === album.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {/* Album thumbnail */}
                      <div className="w-12 h-12 bg-gray-100 rounded flex-shrink-0 flex items-center justify-center overflow-hidden">
                        {album.coverPhotoUrl ? (
                          <img
                            src={album.coverPhotoUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-800 truncate">{album.name}</h3>
                        <p className="text-sm text-gray-500">
                          {album.photoCount} {album.photoCount === 1 ? 'photo' : 'photos'}
                        </p>
                      </div>

                      {selectedAlbumId === album.id && (
                        <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-4">
                  No albums yet. Create one above!
                </p>
              )}
            </>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!selectedAlbumId || saving}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            Add to Album
          </button>
        </div>
      </div>
    </div>
  );
}
