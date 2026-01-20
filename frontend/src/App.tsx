import React, { useState, useEffect, useCallback } from "react";
import { fetchPhotos, getAuthenticatedImageUrl, Photo } from './api';
import { auth } from './firebase';
import { useInfinitePhotos } from './hooks/useInfinitePhotos';
import { useIntersectionSentinel } from './hooks/useIntersectionSentinel';
import { useAuth } from './hooks/useAuth';
import { usePhotoSelection } from './hooks/usePhotoSelection';
import { Avatar } from './components/Avatar';
import { PhotoMasonry } from './components/PhotoMasonry';
import { BulkActionBar } from './components/BulkActionBar';
import { ImageModal } from './components/ImageModal';
import { ToastProvider, useToast } from './components/Toast';

// Version check to verify new code is loading
console.log("App bundle version", "2026-01-20-refactor");

type ViewType = 'photos' | 'people' | 'memories' | 'shared';

function AppContent() {
  const { showToast } = useToast();

  // Use extracted auth hook
  const { user, loading: authLoading, error: authError, signIn, signOut } = useAuth();

  // Modal state
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string>('');
  const [currentView, setCurrentView] = useState<ViewType>('photos');
  const [modalLoading, setModalLoading] = useState(false);

  // When a photo fetch fails, pause infinite auto-loading to avoid hammering auth/token endpoints.
  const [autoLoadPaused, setAutoLoadPaused] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Use the infinite scroll hook
  const {
    photos,
    hasMore,
    loading,
    error,
    reset,
    loadMore,
  } = useInfinitePhotos(fetchPhotos, 50);

  // Use extracted photo selection hook
  const {
    selectedIds,
    selectMode,
    toggleSelection,
    clearSelection,
    selectAll,
  } = usePhotoSelection(photos);

  // Pause auto-loading immediately on error to prevent tight retry loops.
  useEffect(() => {
    if (error) setAutoLoadPaused(true);
  }, [error]);

  const retryLoad = useCallback(async () => {
    // Manual retry: clear pause + reset paging + load one page.
    setAutoLoadPaused(false);
    reset();
    await loadMore();
  }, [reset, loadMore]);

  // Handle photo click with multi-select logic
  const handlePhotoClick = useCallback(async (photo: Photo, event?: React.MouseEvent) => {
    // If any modifier keys are pressed, handle as selection
    if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
      toggleSelection(photo.id, event);
      return;
    }

    // Normal click - open modal
    setSelectedPhoto(photo);
    setModalLoading(false);

    try {
      const authenticatedUrl = await getAuthenticatedImageUrl(photo.fullUrl);
      setSelectedPhotoUrl(authenticatedUrl);
    } catch (err) {
      console.error("Error loading full-size image:", err);
      setSelectedPhotoUrl(photo.fullUrl); // Fallback to original URL
    }
  }, [toggleSelection]);

  // Bulk action handler
  const handleBulkAction = useCallback(async (action: string, albumName?: string) => {
    if (selectedIds.size === 0) return;

    setBulkActionLoading(true);
    try {
      const photoIds = Array.from(selectedIds);

      // Get auth token
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch('/api/photos/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          action,
          photoIds,
          albumName,
        }),
      });

      if (!response.ok) {
        throw new Error(`Bulk ${action} failed: ${response.statusText}`);
      }

      const result = await response.json();

      // Clear selection after successful operation
      clearSelection();

      // Refresh photos to reflect changes
      reset();
      await loadMore();

      // Show success message
      showToast('success', `${action} completed successfully for ${result.updated} photos`);

      if (result.errors.length > 0) {
        showToast('error', `${result.errors.length} operations failed`);
      }

    } catch (error) {
      console.error('Bulk action error:', error);
      showToast('error', `Failed to ${action}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setBulkActionLoading(false);
    }
  }, [selectedIds, clearSelection, reset, loadMore, showToast]);

  // Handle sign out with reset
  const handleSignOut = useCallback(async () => {
    await signOut();
    reset();
    setAutoLoadPaused(false);
  }, [signOut, reset]);

  // Initial load when entering photos view + user exists
  useEffect(() => {
    if (currentView !== "photos") return;
    if (!user) return;

    // If we previously paused due to an error, keep it paused until manual retry.
    reset();
    void loadMore();
  }, [currentView, user, reset, loadMore]);

  // Load more only when sentinel hits viewport.
  // IMPORTANT: disable when there's an error or when we've paused auto loading.
  const sentinelRef = useIntersectionSentinel({
    enabled: currentView === "photos" && !!user && hasMore && !loading && !error && !autoLoadPaused,
    onIntersect: () => void loadMore(),
  });

  // Keyboard shortcuts for multi-select
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (currentView !== 'photos') return;

      switch (event.key) {
        case 'Escape':
          if (selectedIds.size > 0) {
            clearSelection();
            event.preventDefault();
          }
          break;
        case 'a':
          if (event.ctrlKey || event.metaKey) {
            selectAll(photos);
            event.preventDefault();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentView, selectedIds.size, clearSelection, selectAll, photos]);

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

  // Main content renderer using switch pattern
  const renderView = () => {
    // Handle authentication states first
    if (authLoading) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex items-center space-x-2 text-gray-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span>Loading...</span>
          </div>
        </div>
      );
    }

    if (!user) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <div className="max-w-md">
            <div className="text-6xl mb-6">📸</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Welcome to Family Photos
            </h2>
            <p className="text-gray-600 mb-8">
              Sign in with Google to view and manage your family photo collection.
            </p>
            <button
              onClick={signIn}
              className="bg-blue-600 text-white px-8 py-3 rounded-lg text-lg font-medium hover:bg-blue-700 transition-colors flex items-center space-x-3 mx-auto"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span>Sign In with Google</span>
            </button>
            <p className="text-sm text-gray-500 mt-4 text-center">
              Robust authentication (works in all browsers)
            </p>
            {authError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">
                  <strong>Authentication Error:</strong><br/>
                  {authError}
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Handle authenticated views
    switch (currentView) {
      case 'photos':
        return (
          <div className="px-4 sm:px-6 lg:px-8">
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <pre className="text-red-600 whitespace-pre-wrap">{error}</pre>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={() => void retryLoad()}
                    className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 transition-colors"
                    disabled={loading}
                  >
                    Try again
                  </button>
                  {autoLoadPaused && (
                    <span className="text-sm text-red-700">
                      Auto-loading paused to prevent repeated retries.
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Photo Masonry Grid */}
            <PhotoMasonry
              photos={photos}
              onPhotoClick={handlePhotoClick}
              selectedIds={selectedIds}
              selectMode={selectMode}
            />

            {/* Sentinel goes AFTER the grid */}
            <div ref={sentinelRef} className="h-10" />

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

            {photos.length === 0 && !loading && !error && (
              <div className="text-center py-12 text-gray-500">
                <p>No photos found. Check back later!</p>
              </div>
            )}

            {/* Bulk Action Bar */}
            <BulkActionBar
              selectedCount={selectedIds.size}
              onAction={handleBulkAction}
              onClear={clearSelection}
              isLoading={bulkActionLoading}
            />
          </div>
        );

      case 'people':
        return renderPlaceholderView('People', '👥');

      case 'memories':
        return renderPlaceholderView('Memories', '📅');

      case 'shared':
        return renderPlaceholderView('Shared', '📤');

      default:
        return (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-400">
            <div className="text-6xl mb-4">❓</div>
            <h2 className="text-xl font-medium mb-2">Unknown View</h2>
            <p className="text-center max-w-md">
              This view is not available. Please select a different option.
            </p>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-semibold text-gray-900">Photos</h1>
            <div className="flex items-center space-x-4">
              {user ? (
                <>
                  {/* Navigation */}
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

                  {/* User Info & Sign Out */}
                  <div className="flex items-center space-x-3">
                    <Avatar photoURL={user.photoURL} name={user.displayName} />
                    <span className="text-sm text-gray-700">{user.displayName}</span>
                    <button
                      onClick={handleSignOut}
                      className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1 rounded-md hover:bg-gray-100"
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={signIn}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Sign In with Google
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-8">
        {renderView()}
      </main>

      {/* Full-Screen Modal */}
      <ImageModal
        photo={selectedPhoto}
        imageUrl={selectedPhotoUrl}
        loading={modalLoading}
        onClose={closeModal}
      />
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

export default App;
