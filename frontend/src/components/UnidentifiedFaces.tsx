import React, { useState, useEffect, useCallback } from 'react';
import { fetchUnidentifiedPhotos, PhotoWithFaces } from '../api';
import { FaceTagModal } from './FaceTagModal';

interface UnidentifiedFacesProps {
  onBack: () => void;
}

export function UnidentifiedFaces({ onBack }: UnidentifiedFacesProps) {
  const [photos, setPhotos] = useState<PhotoWithFaces[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoWithFaces | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const loadPhotos = useCallback(async (resetOffset = false) => {
    setLoading(true);
    setError(null);
    try {
      const currentOffset = resetOffset ? 0 : offset;
      const data = await fetchUnidentifiedPhotos(currentOffset, limit);
      setPhotos(data.photos);
      setTotal(data.total);
      if (resetOffset) setOffset(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, [offset, limit]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const handlePhotoClick = useCallback((photo: PhotoWithFaces) => {
    setSelectedPhoto(photo);
  }, []);

  const handleModalClose = useCallback(() => {
    setSelectedPhoto(null);
  }, []);

  const handleUpdate = useCallback(() => {
    // Reload photos after tagging
    loadPhotos(true);
  }, [loadPhotos]);

  const handleLoadMore = useCallback(() => {
    setOffset(prev => prev + limit);
  }, [limit]);

  const hasMore = photos.length < total;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            className="flex items-center space-x-2 text-blue-600 hover:text-blue-800"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Back to People</span>
          </button>
        </div>
        <div className="text-sm text-gray-500">
          {total} photo{total !== 1 ? 's' : ''} with unidentified faces
        </div>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-4">
        Unidentified Faces
        <span className="text-gray-500 font-normal text-lg ml-2">
          (Review and tag)
        </span>
      </h2>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600">{error}</p>
          <button
            onClick={() => loadPhotos(true)}
            className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && photos.length === 0 ? (
        <div className="flex justify-center items-center py-12">
          <div className="flex items-center space-x-2 text-gray-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span>Loading photos...</span>
          </div>
        </div>
      ) : photos.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <div className="text-6xl mb-4">🎉</div>
          <h3 className="text-xl font-medium mb-2">All caught up!</h3>
          <p>No photos with unidentified faces.</p>
          <p className="text-sm mt-2">
            Run the face scanner to detect faces in new photos.
          </p>
        </div>
      ) : (
        <>
          {/* Photo grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {photos.map((photo) => (
              <button
                key={photo.id}
                onClick={() => handlePhotoClick(photo)}
                className="group relative bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-gray-100 relative">
                  <img
                    src={photo.thumbnailUrl}
                    alt={photo.filename}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    loading="lazy"
                  />

                  {/* Unidentified count badge */}
                  <div className="absolute top-2 right-2 bg-yellow-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                    {photo.unidentifiedCount} face{photo.unidentifiedCount !== 1 ? 's' : ''}
                  </div>

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center">
                    <span className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                      Review
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Load more button */}
          {hasMore && (
            <div className="mt-8 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Loading...' : `Load More (${photos.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Face tag modal */}
      {selectedPhoto && (
        <FaceTagModal
          photo={selectedPhoto}
          imageUrl={selectedPhoto.fullUrl}
          onClose={handleModalClose}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
