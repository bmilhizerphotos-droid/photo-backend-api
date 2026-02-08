import React, { useState, useCallback } from "react";
import { fetchPhotos, Photo } from "./api";
import { useInfinitePhotos } from "./hooks/useInfinitePhotos";
import { usePhotoSelection } from "./hooks/usePhotoSelection";
import { PhotoMasonry } from "./components/PhotoMasonry";
import { ImageModal } from "./components/ImageModal";

export default function App() {
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);

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

  const handlePhotoClick = useCallback(
    (photo: Photo, event?: React.MouseEvent) => {
      if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
        toggleSelection(photo.id, event);
        return;
      }

      // ✅ THIS IS THE FIX
      setModalImageUrl(photo.image_url);
    },
    [toggleSelection]
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <PhotoMasonry
        photos={photos}
        onPhotoClick={handlePhotoClick}
        selectedIds={selectedIds}
        selectMode={selectMode}
      />

      {hasMore && !loading && (
        <div className="h-10" onMouseEnter={loadMore} />
      )}

      <ImageModal
        imageUrl={modalImageUrl}
        onClose={() => setModalImageUrl(null)}
      />
    </div>
  );
}
