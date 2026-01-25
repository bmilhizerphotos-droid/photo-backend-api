import React, { useState, useEffect, useCallback } from "react";
import { fetchPhotos, fetchPeople, fetchPersonPhotos, fetchAlbum, fetchAlbums, fetchMemory, updateMemory, Photo, Person, Album } from './api';
import MemoriesGrid from './components/MemoriesGrid';
import { auth } from './firebase';
import { useInfinitePhotos } from './hooks/useInfinitePhotos';
import { useIntersectionSentinel } from './hooks/useIntersectionSentinel';
import { useAuth } from './hooks/useAuth';
import { usePhotoSelection } from './hooks/usePhotoSelection';
import { Avatar } from './components/Avatar';
import { PhotoMasonry } from './components/PhotoMasonry';
import { PeopleGrid } from './components/PeopleGrid';
import { BulkActionBar } from './components/BulkActionBar';
import { ImageModal } from './components/ImageModal';
import { UnidentifiedFaces } from './components/UnidentifiedFaces';
import AlbumsGrid from './components/AlbumsGrid';
import CreateAlbumModal from './components/CreateAlbumModal';
import AddToAlbumModal from './components/AddToAlbumModal';
import { ToastProvider, useToast } from './components/Toast';
import Sidebar, { AppView } from './components/Sidebar';

// Version check to verify new code is loading
console.log("App bundle version", "2026-01-24-sidebar");

function AppContent() {
  const { showToast } = useToast();

  // Use extracted auth hook
  const { user, loading: authLoading, error: authError, signIn, signOut } = useAuth();

  // Modal state
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string>('');
  const [currentView, setCurrentView] = useState<AppView>('photos');
  const [modalLoading, setModalLoading] = useState(false);

  // When a photo fetch fails, pause infinite auto-loading to avoid hammering auth/token endpoints.
  const [autoLoadPaused, setAutoLoadPaused] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // People state
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [personPhotos, setPersonPhotos] = useState<Photo[]>([]);
  const [personPhotosLoading, setPersonPhotosLoading] = useState(false);

  // Albums state
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<Photo[]>([]);
  const [albumPhotosLoading, setAlbumPhotosLoading] = useState(false);
  const [albumName, setAlbumName] = useState<string>('');
  const [albumRefreshTrigger, setAlbumRefreshTrigger] = useState(0);
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false);
  const [showAddToAlbumModal, setShowAddToAlbumModal] = useState(false);

  // Memories state
  const [memoryPhotos, setMemoryPhotos] = useState<Photo[]>([]);
  const [memoryPhotosLoading, setMemoryPhotosLoading] = useState(false);
  const [memoryTitle, setMemoryTitle] = useState<string>('');
  const [memoryNarrative, setMemoryNarrative] = useState<string | null>(null);
  const [memoryId, setMemoryId] = useState<number | null>(null);
  const [memoryLocationLabel, setMemoryLocationLabel] = useState<string | null>(null);
  const [memoryCoverPhotoId, setMemoryCoverPhotoId] = useState<number | null>(null);
  const [editingMemoryField, setEditingMemoryField] = useState<'title' | 'narrative' | 'location' | null>(null);
  const [editingMemoryValue, setEditingMemoryValue] = useState<string>('');
  const [memoryUpdateLoading, setMemoryUpdateLoading] = useState(false);
  const [coverPhotoSelectMode, setCoverPhotoSelectMode] = useState(false);

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

  // Load albums for sidebar when user is authenticated
  useEffect(() => {
    if (!user) {
      setAlbums([]);
      return;
    }

    const loadAlbums = async () => {
      try {
        const data = await fetchAlbums();
        setAlbums(data);
      } catch (err) {
        console.error("Failed to load albums for sidebar:", err);
      }
    };

    loadAlbums();
  }, [user, albumRefreshTrigger]);

  const retryLoad = useCallback(async () => {
    // Manual retry: clear pause + reset paging + load one page.
    setAutoLoadPaused(false);
    reset();
    await loadMore();
  }, [reset, loadMore]);

  // Handle photo click with multi-select logic
  const handlePhotoClick = useCallback((photo: Photo, event?: React.MouseEvent) => {
    // If any modifier keys are pressed, handle as selection
    if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
      toggleSelection(photo.id, event);
      return;
    }

    // Normal click - open modal
    // URLs are already authenticated from fetchPhotos, so use them directly
    setSelectedPhoto(photo);
    setSelectedPhotoUrl(photo.fullUrl);
    setModalLoading(false);
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

  // Load people when entering people view
  useEffect(() => {
    if (currentView !== "people") return;
    if (!user) return;

    const loadPeople = async () => {
      setPeopleLoading(true);
      setPeopleError(null);
      try {
        const data = await fetchPeople();
        setPeople(data);
      } catch (err) {
        setPeopleError(err instanceof Error ? err.message : "Failed to load people");
      } finally {
        setPeopleLoading(false);
      }
    };

    loadPeople();
  }, [currentView, user]);

  // Handle person click - load their photos
  const handlePersonClick = useCallback(async (person: Person) => {
    setSelectedPerson(person);
    setPersonPhotosLoading(true);
    try {
      const photos = await fetchPersonPhotos(person.id, 0, 100);
      setPersonPhotos(photos);
    } catch (err) {
      console.error("Failed to load person photos:", err);
    } finally {
      setPersonPhotosLoading(false);
    }
  }, []);

  // Go back to people list
  const handleBackToPeople = useCallback(() => {
    setSelectedPerson(null);
    setPersonPhotos([]);
  }, []);

  // Handle album selection - load album photos
  const handleSelectAlbum = useCallback(async (albumId: number) => {
    setSelectedAlbumId(albumId);
    setCurrentView('album-detail');
    setAlbumPhotosLoading(true);
    try {
      const album = await fetchAlbum(albumId);
      setAlbumName(album.name);
      setAlbumPhotos(album.photos);
    } catch (err) {
      console.error("Failed to load album:", err);
      showToast('error', 'Failed to load album');
    } finally {
      setAlbumPhotosLoading(false);
    }
  }, [showToast]);

  // Go back to albums list
  const handleBackToAlbums = useCallback(() => {
    setSelectedAlbumId(null);
    setAlbumPhotos([]);
    setAlbumName('');
    setCurrentView('albums');
  }, []);

  // Handle album created
  const handleAlbumCreated = useCallback(() => {
    setAlbumRefreshTrigger(prev => prev + 1);
    showToast('success', 'Album created successfully');
  }, [showToast]);

  // Handle memory selection - load memory photos
  const handleSelectMemory = useCallback(async (id: number) => {
    setCurrentView('memory-detail');
    setMemoryPhotosLoading(true);
    try {
      const memory = await fetchMemory(id);
      setMemoryId(id);
      setMemoryTitle(memory.title || 'Untitled Memory');
      setMemoryNarrative(memory.narrative);
      setMemoryLocationLabel(memory.locationLabel);
      setMemoryCoverPhotoId(memory.coverPhotoId);
      setMemoryPhotos(memory.photos);
    } catch (err) {
      console.error("Failed to load memory:", err);
      showToast('error', 'Failed to load memory');
    } finally {
      setMemoryPhotosLoading(false);
    }
  }, [showToast]);

  // Go back to memories list
  const handleBackToMemories = useCallback(() => {
    setMemoryPhotos([]);
    setMemoryTitle('');
    setMemoryNarrative(null);
    setMemoryId(null);
    setMemoryLocationLabel(null);
    setMemoryCoverPhotoId(null);
    setEditingMemoryField(null);
    setEditingMemoryValue('');
    setCoverPhotoSelectMode(false);
    setCurrentView('memories');
  }, []);

  // Save an edited memory field
  const handleMemorySave = useCallback(async (field: 'title' | 'narrative' | 'location', value: string) => {
    if (!memoryId) return;
    setMemoryUpdateLoading(true);
    try {
      const updates: Record<string, string | null> = {};
      if (field === 'title') updates.title = value;
      else if (field === 'narrative') updates.narrative = value || null;
      else if (field === 'location') updates.locationLabel = value || null;

      await updateMemory(memoryId, updates);

      // Update local state
      if (field === 'title') setMemoryTitle(value || 'Untitled Memory');
      else if (field === 'narrative') setMemoryNarrative(value || null);
      else if (field === 'location') setMemoryLocationLabel(value || null);

      setEditingMemoryField(null);
      setEditingMemoryValue('');
      showToast('success', `Memory ${field} updated`);
    } catch (err) {
      console.error("Failed to update memory:", err);
      showToast('error', `Failed to update ${field}`);
    } finally {
      setMemoryUpdateLoading(false);
    }
  }, [memoryId, showToast]);

  // Set cover photo for a memory
  const handleSetCoverPhoto = useCallback(async (photoId: number) => {
    if (!memoryId) return;
    setMemoryUpdateLoading(true);
    try {
      await updateMemory(memoryId, { coverPhotoId: photoId });
      setMemoryCoverPhotoId(photoId);
      setCoverPhotoSelectMode(false);
      showToast('success', 'Cover photo updated');
    } catch (err) {
      console.error("Failed to set cover photo:", err);
      showToast('error', 'Failed to update cover photo');
    } finally {
      setMemoryUpdateLoading(false);
    }
  }, [memoryId, showToast]);

  // Handle photos added to album
  const handleAddedToAlbum = useCallback((albumId: number, albumName: string) => {
    showToast('success', `Added ${selectedIds.size} photos to "${albumName}"`);
    clearSelection();
    setAlbumRefreshTrigger(prev => prev + 1);
  }, [selectedIds.size, clearSelection, showToast]);

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

  // Placeholder content for views that are not yet implemented
  const renderPlaceholderView = (title: string, icon: string, description: string) => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-400">
      <div className="text-6xl mb-4">{icon}</div>
      <h2 className="text-xl font-medium mb-2 text-gray-600">{title}</h2>
      <p className="text-center max-w-md">
        {description}
      </p>
    </div>
  );

  // Main content renderer using switch pattern
  const renderView = () => {
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
              selectedIds={selectedIds}
              onAction={handleBulkAction}
              onClear={clearSelection}
              isLoading={bulkActionLoading}
              onAddToAlbum={() => setShowAddToAlbumModal(true)}
            />
          </div>
        );

      case 'favorites':
        return renderPlaceholderView(
          'Favorites',
          '❤️',
          'Your favorite photos will appear here. Mark photos as favorites to quickly find them later.'
        );

      case 'people':
        return (
          <div className="px-4 sm:px-6 lg:px-8">
            {selectedPerson ? (
              // Show photos for selected person
              <>
                <div className="mb-6 flex items-center space-x-4">
                  <button
                    onClick={handleBackToPeople}
                    className="flex items-center space-x-2 text-blue-600 hover:text-blue-800"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    <span>Back to People</span>
                  </button>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  {selectedPerson.name}
                  <span className="text-gray-500 font-normal text-lg ml-2">
                    ({selectedPerson.photoCount} photos)
                  </span>
                </h2>
                {personPhotosLoading ? (
                  <div className="flex justify-center items-center py-12">
                    <div className="flex items-center space-x-2 text-gray-500">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                      <span>Loading photos...</span>
                    </div>
                  </div>
                ) : (
                  <PhotoMasonry
                    photos={personPhotos}
                    onPhotoClick={handlePhotoClick}
                    selectedIds={selectedIds}
                    selectMode={selectMode}
                  />
                )}
              </>
            ) : (
              // Show people grid
              <>
                {peopleError && (
                  <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-600">{peopleError}</p>
                  </div>
                )}
                <PeopleGrid
                  people={people}
                  onPersonClick={handlePersonClick}
                  onUnidentifiedClick={() => setCurrentView('unidentified')}
                  loading={peopleLoading}
                />
              </>
            )}
          </div>
        );

      case 'unidentified':
        return (
          <div className="px-4 sm:px-6 lg:px-8">
            <UnidentifiedFaces
              onBack={() => setCurrentView('people')}
            />
          </div>
        );

      case 'memories':
        return (
          <div className="px-4 sm:px-6 lg:px-8">
            <MemoriesGrid onSelectMemory={handleSelectMemory} />
          </div>
        );

      case 'memory-detail':
        return (
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
              <button
                onClick={handleBackToMemories}
                className="flex items-center space-x-2 text-blue-600 hover:text-blue-800"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Back to Memories</span>
              </button>
              {!coverPhotoSelectMode ? (
                <button
                  onClick={() => setCoverPhotoSelectMode(true)}
                  className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-md hover:bg-gray-100 border border-gray-300"
                >
                  Change Cover
                </button>
              ) : (
                <button
                  onClick={() => setCoverPhotoSelectMode(false)}
                  className="text-sm text-red-600 hover:text-red-800 px-3 py-1.5 rounded-md hover:bg-red-50 border border-red-300"
                >
                  Cancel
                </button>
              )}
            </div>

            {coverPhotoSelectMode && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                Click any photo below to set it as the cover photo.
              </div>
            )}

            {/* Editable Title */}
            {editingMemoryField === 'title' ? (
              <input
                autoFocus
                className="text-2xl font-bold text-gray-900 mb-1 w-full bg-white border border-blue-400 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300"
                value={editingMemoryValue}
                disabled={memoryUpdateLoading}
                onChange={(e) => setEditingMemoryValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleMemorySave('title', editingMemoryValue);
                  } else if (e.key === 'Escape') {
                    setEditingMemoryField(null);
                    setEditingMemoryValue('');
                  }
                }}
                onBlur={() => void handleMemorySave('title', editingMemoryValue)}
              />
            ) : (
              <h2
                className="text-2xl font-bold text-gray-900 mb-1 cursor-pointer group flex items-center gap-2 hover:text-blue-800"
                onClick={() => {
                  setEditingMemoryField('title');
                  setEditingMemoryValue(memoryTitle);
                }}
              >
                {memoryTitle}
                <svg className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </h2>
            )}

            {/* Editable Location */}
            {editingMemoryField === 'location' ? (
              <input
                autoFocus
                className="text-sm text-gray-500 mb-2 w-full max-w-md bg-white border border-blue-400 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300"
                value={editingMemoryValue}
                placeholder="Add location"
                disabled={memoryUpdateLoading}
                onChange={(e) => setEditingMemoryValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleMemorySave('location', editingMemoryValue);
                  } else if (e.key === 'Escape') {
                    setEditingMemoryField(null);
                    setEditingMemoryValue('');
                  }
                }}
                onBlur={() => void handleMemorySave('location', editingMemoryValue)}
              />
            ) : (
              <p
                className="text-sm text-gray-500 mb-2 cursor-pointer group flex items-center gap-1 hover:text-blue-600"
                onClick={() => {
                  setEditingMemoryField('location');
                  setEditingMemoryValue(memoryLocationLabel || '');
                }}
              >
                {memoryLocationLabel || <span className="italic text-gray-400">Add location</span>}
                <svg className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </p>
            )}

            {/* Editable Narrative */}
            {editingMemoryField === 'narrative' ? (
              <textarea
                autoFocus
                className="text-gray-600 mb-4 max-w-2xl w-full bg-white border border-blue-400 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300 min-h-[80px]"
                value={editingMemoryValue}
                placeholder="Click to add a narrative..."
                disabled={memoryUpdateLoading}
                onChange={(e) => setEditingMemoryValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleMemorySave('narrative', editingMemoryValue);
                  } else if (e.key === 'Escape') {
                    setEditingMemoryField(null);
                    setEditingMemoryValue('');
                  }
                }}
                onBlur={() => void handleMemorySave('narrative', editingMemoryValue)}
              />
            ) : (
              <p
                className="text-gray-600 mb-4 max-w-2xl cursor-pointer group flex items-start gap-2 hover:text-blue-700"
                onClick={() => {
                  setEditingMemoryField('narrative');
                  setEditingMemoryValue(memoryNarrative || '');
                }}
              >
                <span>{memoryNarrative || <span className="italic text-gray-400">Click to add a narrative...</span>}</span>
                <svg className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </p>
            )}

            <p className="text-gray-500 text-sm mb-4">
              {memoryPhotos.length} {memoryPhotos.length === 1 ? 'photo' : 'photos'}
            </p>
            {memoryPhotosLoading ? (
              <div className="flex justify-center items-center py-12">
                <div className="flex items-center space-x-2 text-gray-500">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                  <span>Loading photos...</span>
                </div>
              </div>
            ) : memoryPhotos.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p>No photos in this memory.</p>
              </div>
            ) : (
              <PhotoMasonry
                photos={memoryPhotos}
                onPhotoClick={coverPhotoSelectMode
                  ? (photo: Photo) => void handleSetCoverPhoto(photo.id)
                  : handlePhotoClick
                }
                selectedIds={coverPhotoSelectMode && memoryCoverPhotoId ? new Set([memoryCoverPhotoId]) : selectedIds}
                selectMode={coverPhotoSelectMode || selectMode}
              />
            )}
          </div>
        );

      case 'shared':
        return renderPlaceholderView(
          'Shared Albums',
          '🔗',
          'Albums shared with you and albums you\'ve shared with others will appear here.'
        );

      case 'import':
        return renderPlaceholderView(
          'Import Photos',
          '📤',
          'Upload new photos to your library. Drag and drop files or click to browse.'
        );

      case 'trash':
        return renderPlaceholderView(
          'Trash',
          '🗑️',
          'Recently deleted photos will appear here for 30 days before being permanently removed.'
        );

      case 'albums':
        return (
          <div className="px-4 sm:px-6 lg:px-8">
            <AlbumsGrid
              onSelectAlbum={handleSelectAlbum}
              onCreateAlbum={() => setShowCreateAlbumModal(true)}
              refreshTrigger={albumRefreshTrigger}
            />
          </div>
        );

      case 'album-detail':
        return (
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center space-x-4">
              <button
                onClick={handleBackToAlbums}
                className="flex items-center space-x-2 text-blue-600 hover:text-blue-800"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Back to Albums</span>
              </button>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {albumName}
              <span className="text-gray-500 font-normal text-lg ml-2">
                ({albumPhotos.length} photos)
              </span>
            </h2>
            {albumPhotosLoading ? (
              <div className="flex justify-center items-center py-12">
                <div className="flex items-center space-x-2 text-gray-500">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                  <span>Loading photos...</span>
                </div>
              </div>
            ) : albumPhotos.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p>This album is empty. Add photos using the bulk action bar.</p>
              </div>
            ) : (
              <PhotoMasonry
                photos={albumPhotos}
                onPhotoClick={handlePhotoClick}
                selectedIds={selectedIds}
                selectMode={selectMode}
              />
            )}
          </div>
        );

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

  // Loading state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center space-x-2 text-gray-500">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="text-lg">Loading...</span>
        </div>
      </div>
    );
  }

  // Not authenticated - show sign in
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center text-center px-4">
        <div className="max-w-md">
          <div className="text-8xl mb-6">📸</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Family Photos
          </h1>
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
          {authError && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
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

  // Authenticated - show main app with sidebar
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <Sidebar
        view={currentView}
        onChangeView={setCurrentView}
        albums={albums}
        selectedAlbumId={selectedAlbumId}
        onSelectAlbum={handleSelectAlbum}
        onCreateAlbum={() => setShowCreateAlbumModal(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
          <div className="px-6 h-14 flex items-center justify-end">
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
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 py-6 overflow-auto">
          {renderView()}
        </main>
      </div>

      {/* Full-Screen Modal */}
      <ImageModal
        photo={selectedPhoto}
        imageUrl={selectedPhotoUrl}
        loading={modalLoading}
        onClose={closeModal}
      />

      {/* Create Album Modal */}
      <CreateAlbumModal
        isOpen={showCreateAlbumModal}
        onClose={() => setShowCreateAlbumModal(false)}
        onCreated={handleAlbumCreated}
      />

      {/* Add to Album Modal */}
      <AddToAlbumModal
        isOpen={showAddToAlbumModal}
        onClose={() => setShowAddToAlbumModal(false)}
        photoIds={Array.from(selectedIds)}
        onAdded={handleAddedToAlbum}
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
