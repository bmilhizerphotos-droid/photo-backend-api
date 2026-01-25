// FILE: frontend/src/components/AlbumsGrid.tsx
import { useState, useEffect } from 'react';
import { fetchAlbums, deleteAlbum, Album } from '../api';

interface AlbumsGridProps {
  onSelectAlbum: (albumId: number) => void;
  onCreateAlbum: () => void;
  refreshTrigger?: number;
}

export default function AlbumsGrid({ onSelectAlbum, onCreateAlbum, refreshTrigger }: AlbumsGridProps) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    loadAlbums();
  }, [refreshTrigger]);

  async function loadAlbums() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAlbums();
      setAlbums(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load albums');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(albumId: number, e: React.MouseEvent) {
    e.stopPropagation();

    if (!confirm('Are you sure you want to delete this album? Photos will not be deleted.')) {
      return;
    }

    try {
      setDeletingId(albumId);
      await deleteAlbum(albumId);
      setAlbums(prev => prev.filter(a => a.id !== albumId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete album');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-500">
        <p>{error}</p>
        <button
          onClick={loadAlbums}
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
        <h2 className="text-2xl font-bold text-gray-800">My Albums</h2>
        <button
          onClick={onCreateAlbum}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Album
        </button>
      </div>

      {albums.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p className="text-lg">No albums yet</p>
          <p className="text-sm mt-1">Create an album to organize your photos</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {albums.map(album => (
            <div
              key={album.id}
              onClick={() => onSelectAlbum(album.id)}
              className="group relative bg-white rounded-lg shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
            >
              {/* Album cover */}
              <div className="aspect-square bg-gray-100 flex items-center justify-center">
                {album.coverPhotoUrl ? (
                  <img
                    src={album.coverPhotoUrl}
                    alt={album.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
              </div>

              {/* Album info */}
              <div className="p-3">
                <h3 className="font-medium text-gray-800 truncate">{album.name}</h3>
                <p className="text-sm text-gray-500">
                  {album.photoCount} {album.photoCount === 1 ? 'photo' : 'photos'}
                </p>
              </div>

              {/* Delete button (shown on hover) */}
              <button
                onClick={(e) => handleDelete(album.id, e)}
                disabled={deletingId === album.id}
                className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 disabled:opacity-50"
              >
                {deletingId === album.id ? (
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
    </div>
  );
}
