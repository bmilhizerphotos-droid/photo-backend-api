import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Photo } from '../api';

interface FullImageProps {
  src: string;
  alt?: string;
  fallbackSrc?: string;
  className?: string;
}

function FullImage({ src, alt = "", fallbackSrc, className }: FullImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const handledRef = useRef(false);

  // Keep state in sync when src changes from parent.
  useEffect(() => {
    handledRef.current = false;
    setCurrentSrc(src);
    setImageLoaded(false);
    setImageError(false);
  }, [src]);

  const onError = useCallback(() => {
    console.error('Image failed to load:', currentSrc);
    if (handledRef.current) return;
    handledRef.current = true;

    if (fallbackSrc && fallbackSrc !== currentSrc) {
      setCurrentSrc(fallbackSrc);
      return;
    }

    setImageError(true);
  }, [fallbackSrc, currentSrc]);

  const onLoad = useCallback(() => {
    setImageLoaded(true);
    setImageError(false);
  }, []);

  return (
    <div className="relative">
      {!imageLoaded && !imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="text-gray-400">Loading image...</div>
        </div>
      )}
      {imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="text-red-500">Failed to load image</div>
        </div>
      )}
      <img
        src={currentSrc}
        alt={alt}
        className={className}
        onError={onError}
        onLoad={onLoad}
        style={{ display: imageLoaded ? 'block' : 'none' }}
      />
    </div>
  );
}

interface ImageModalProps {
  photo: Photo | null;
  imageUrl: string;
  loading: boolean;
  onClose: () => void;
}

export function ImageModal({ photo, imageUrl, loading, onClose }: ImageModalProps) {
  // Close modal on Escape key
  useEffect(() => {
    if (!photo) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [photo, onClose]);

  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="relative max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-10 h-10 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full flex items-center justify-center text-xl transition-colors"
        >
          x
        </button>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center w-96 h-96 bg-gray-800 rounded-lg">
            <div className="flex items-center space-x-2 text-white">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              <span>Loading...</span>
            </div>
          </div>
        )}

        {/* Full-Size Image */}
        {!loading && imageUrl && (
          <div className="bg-white rounded-lg overflow-hidden shadow-2xl max-w-5xl max-h-[90vh]">
            <FullImage
              src={imageUrl}
              alt={photo.filename}
              fallbackSrc={photo.thumbnailUrl}
              className="w-full h-auto max-h-[80vh] object-contain"
            />

            {/* Metadata */}
            <div className="p-4 bg-white border-t border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-gray-900 truncate">
                    {photo.filename}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Photo ID: {photo.id}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
