import React from 'react';
import { Photo } from '../api';

interface PhotoMasonryProps {
  photos: Photo[];
  onPhotoClick: (photo: Photo) => void;
}

export function PhotoMasonry({ photos, onPhotoClick }: PhotoMasonryProps) {
  return (
    <div
      className="w-full columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-4"
      style={{ columnFill: 'balance' }}
    >
      {photos.map((photo) => (
        <div
          key={photo.id}
          className="break-inside-avoid mb-4 cursor-pointer group inline-block w-full"
          onClick={() => onPhotoClick(photo)}
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
      ))}
    </div>
  );
}