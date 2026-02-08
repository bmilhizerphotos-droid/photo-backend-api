import React, { useState, useCallback, useEffect } from "react";
import { fetchPhotos, fetchAlbums, Photo, Album } from "./api";
import { useInfinitePhotos } from "./hooks/useInfinitePhotos";
import { usePhotoSelection } from "./hooks/usePhotoSelection";
import { PhotoMasonry } from "./components/PhotoMasonry";
import { ImageModal } from "./components/ImageModal";
import Sidebar, { AppView } from "./components/Sidebar";

export default function App() {
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<AppView>("photos");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);

  const {
    photos,
    hasMore,
    loading,
    error,
    loadMore,
  } = useInfinitePhotos(fetchPhotos, 50);

  const {
    selectedIds,
    selectMode,
    toggleSelection,
  } = usePhotoSelection(photos);

  // Load albums for sidebar
  useEffect(() => {
    fetchAlbums().then(setAlbums).catch(() => setAlbums([]));
  }, []);

  const handlePhotoClick = useCallback(
    (photo: Photo, event?: React.MouseEvent) => {
      if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
        toggleSelection(photo.id, event);
        return;
      }
      setModalImageUrl(photo.image_url);
    },
    [toggleSelection]
  );

  const handleSelectAlbum = useCallback((albumId: number) => {
    setSelectedAlbumId(albumId);
    setCurrentView("album-detail");
  }, []);

  const renderView = () => {
    switch (currentView) {
      case "photos":
        return (
          <>
            <PhotoMasonry
              photos={photos}
              onPhotoClick={handlePhotoClick}
              selectedIds={selectedIds}
              selectMode={selectMode}
            />
            {hasMore && !loading && (
              <div className="h-10" onMouseEnter={loadMore} />
            )}
          </>
        );
      default:
        return (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p className="text-lg">{currentView.charAt(0).toUpperCase() + currentView.slice(1)} — coming soon</p>
          </div>
        );
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar
        view={currentView}
        onChangeView={setCurrentView}
        albums={albums}
        selectedAlbumId={selectedAlbumId}
        onSelectAlbum={handleSelectAlbum}
        onCreateAlbum={() => {}}
      />

      <main className="flex-1 p-4 overflow-y-auto">
        {renderView()}
      </main>

      <ImageModal
        imageUrl={modalImageUrl}
        onClose={() => setModalImageUrl(null)}
      />
    </div>
  );
}
