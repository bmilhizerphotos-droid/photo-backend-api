import React, { useState } from 'react';
import { Photo } from '../api';

interface PhotoMasonryProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo) => void;
}

function PhotoTile({ photo, onPhotoClick }: { photo: Photo; onPhotoClick: (photo: Photo) => void }) {
  const [imageError, setImageError] = useState(false);

  return (
    <div
      className="cursor-pointer group"
      onClick={() => onPhotoClick(photo)}
    >
      <div className="relative overflow-hidden rounded-lg bg-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 aspect-square">
        {!imageError ? (
          <img
            src={photo.thumbnailUrl}
            alt={photo.filename}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-300 text-gray-500">
            <div className="text-center">
              <div className="text-2xl mb-1">📷</div>
              <div className="text-xs">No preview</div>
            </div>
          </div>
        )}
        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-opacity duration-200" />
      </div>
    </div>
  );
}

export function PhotoMasonry({ photos, onPhotoClick }: PhotoMasonryProps) {
  return (
    <div className="w-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {photos.map((photo) => (
        <PhotoTile
          key={photo.id}
          photo={photo}
          onPhotoClick={onPhotoClick}
        />
      ))}
    </div>
  );
}