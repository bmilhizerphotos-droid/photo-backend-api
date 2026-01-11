import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchPhotos, getAuthenticatedImageUrl, Photo, preloadImage } from './api';

type ViewType = 'photos' | 'people' | 'memories' | 'shared';

function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string>('');
  const [currentView, setCurrentView] = useState<ViewType>('photos');
  const [modalLoading, setModalLoading] = useState(false);

  const observer = useRef<IntersectionObserver | null>(null);
  const LIMIT = 50;

  // Load photos with infinite scroll
  const loadPhotos = useCallback(async () => {
    if (loading || !hasMore || currentView !== 'photos') return;

    setLoading(true);
    try {
      const data = await fetchPhotos(offset, LIMIT);

      if (data.length < LIMIT) {
        setHasMore(false);
      }

      setPhotos(prev => [...prev, ...data]);
      setOffset(prev => prev + LIMIT);
    } catch (err) {
      console.error("Error fetching photos:", err);
    } finally {
      setLoading(false);
    }
  }, [offset, loading, hasMore, currentView]);

  // Initial load and view changes
  useEffect(() => {
    if (currentView === 'photos') {
      loadPhotos();
    } else {
      // Reset for other views
      setPhotos([]);
      setOffset(0);
      setHasMore(false);
    }
  }, [currentView, loadPhotos]);

  // Infinite scroll observer
  const lastPhotoElementRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();

    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && currentView === 'photos') {
        loadPhotos();
      }
    });

    if (node) observer.current.observe(node);
  }, [loading, hasMore, loadPhotos, currentView]);

  // Handle photo click for modal
  const handlePhotoClick = async (photo: Photo) => {
    setSelectedPhoto(photo);
    setModalLoading(true);

    try {
      const authenticatedUrl = await getAuthenticatedImageUrl(photo.fullUrl);
      setSelectedPhotoUrl(authenticatedUrl);

      // Preload the full-size image
      await preloadImage(authenticatedUrl);
    } catch (err) {
      console.error("Error loading full-size image:", err);
      setSelectedPhotoUrl(photo.fullUrl); // Fallback to original URL
    } finally {
      setModalLoading(false);
    }
  };

  // Close modal
  const closeModal = () => {
    setSelectedPhoto(null);
    setSelectedPhotoUrl('');
    setModalLoading(false);
  };

  // Placeholder content for other views
  const renderPlaceholderView = (title: string, icon: string) => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-400">
      <div className="text-6xl mb-4">{icon}</div>
      <h2 className="text-xl font-medium mb-2">{title}</h2>
      <p className="text-center max-w-md">
        This feature is coming soon. For now, enjoy browsing your photo collection!
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-semibold text-gray-900">Photos</h1>
            <nav className="flex space-x-8">
              {[
                { id: 'photos', label: 'Photos', icon: '🖼️' },
                { id: 'people', label: 'People', icon: '👥' },
                { id: 'memories', label: 'Memories', icon: '📅' },
                { id: 'shared', label: 'Shared', icon: '📤' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id as ViewType)}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentView === item.id
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === 'photos' ? (
          <>
            {/* Photo Grid */}
            <div
              className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-7 space-y-6"
              style={{
                columnGap: '28px',
                rowGap: '24px'
              }}
            >
              {photos.map((photo, index) => {
                const isLast = photos.length === index + 1;
                return (
                  <div
                    ref={isLast ? lastPhotoElementRef : null}
                    key={`${photo.id}-${index}`}
                    className="break-inside-avoid cursor-pointer group"
                    onClick={() => handlePhotoClick(photo)}
                  >
                    <div className="relative overflow-hidden rounded-lg bg-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <img
                        src={photo.thumbnailUrl}
                        alt={photo.filename}
                        className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-opacity duration-200" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Loading States */}
            {loading && (
              <div className="flex justify-center items-center py-12">
                <div className="flex items-center space-x-2 text-gray-500">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                  <span>Loading more photos...</span>
                </div>
              </div>
            )}

            {!hasMore && photos.length > 0 && (
              <div className="text-center py-12 text-gray-500">
                <p>You've reached the end of your collection!</p>
              </div>
            )}

            {photos.length === 0 && !loading && (
              <div className="text-center py-12 text-gray-500">
                <p>No photos found. Check back later!</p>
              </div>
            )}
          </>
        ) : currentView === 'people' ? (
          renderPlaceholderView('People', '👥')
        ) : currentView === 'memories' ? (
          renderPlaceholderView('Memories', '📅')
        ) : (
          renderPlaceholderView('Shared', '📤')
        )}
      </main>

      {/* Full-Screen Modal */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div className="relative max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
            {/* Close Button */}
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 z-10 w-10 h-10 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full flex items-center justify-center text-xl transition-colors"
            >
              ✕
            </button>

            {/* Loading State */}
            {modalLoading && (
              <div className="flex items-center justify-center w-96 h-96 bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-2 text-white">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                  <span>Loading...</span>
                </div>
              </div>
            )}

            {/* Full-Size Image */}
            {!modalLoading && selectedPhotoUrl && (
              <div className="bg-white rounded-lg overflow-hidden shadow-2xl max-w-5xl max-h-[90vh]">
                <img
                  src={selectedPhotoUrl}
                  alt={selectedPhoto.filename}
                  className="w-full h-auto max-h-[80vh] object-contain"
                />

                {/* Metadata */}
                <div className="p-4 bg-white border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-medium text-gray-900 truncate">
                        {selectedPhoto.filename}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        Photo ID: {selectedPhoto.id}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
