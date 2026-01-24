import React, { useState } from 'react';
import { Person, bulkTagPhotos, fetchPeople } from '../api';
import { PersonTagPicker } from './PersonTagPicker';

type BulkAction = 'favorite' | 'unfavorite' | 'add_to_album' | 'delete' | 'tag_person';

type Props = {
  selectedCount: number;
  selectedIds: Set<number>;
  onAction: (action: BulkAction, albumId?: number) => Promise<void>;
  onClear: () => void;
  isLoading?: boolean;
  onAddToAlbum?: () => void; // Opens the AddToAlbumModal
};

export function BulkActionBar({ selectedCount, selectedIds, onAction, onClear, isLoading = false, onAddToAlbum }: Props) {
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [tagLoading, setTagLoading] = useState(false);

  const handleFavorite = async () => {
    await onAction('favorite');
  };

  const handleUnfavorite = async () => {
    await onAction('unfavorite');
  };

  const handleDelete = async () => {
    if (confirm(`Delete ${selectedCount} photos? This action cannot be undone.`)) {
      await onAction('delete');
    }
  };

  const handleAddToAlbum = () => {
    if (onAddToAlbum) {
      onAddToAlbum();
    }
  };

  const handleTagPerson = () => {
    setShowTagPicker(true);
  };

  const handleSelectPerson = async (person: Person) => {
    setTagLoading(true);
    try {
      await bulkTagPhotos(Array.from(selectedIds), person.id);
      setShowTagPicker(false);
      onClear();
    } catch (error) {
      console.error('Failed to tag photos:', error);
    } finally {
      setTagLoading(false);
    }
  };

  if (selectedCount === 0) return null;

  return (
    <>
      {/* Sticky Action Bar */}
      <div className="sticky bottom-0 z-30 bg-white border-t border-gray-200 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-gray-900">
                {selectedCount} selected
              </span>
            </div>

            <div className="flex items-center space-x-2">
              {/* Favorite Actions */}
              <button
                onClick={handleFavorite}
                disabled={isLoading}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <span>⭐</span>
                <span>Favorite</span>
              </button>

              <button
                onClick={handleUnfavorite}
                disabled={isLoading}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <span>☆</span>
                <span>Unfavorite</span>
              </button>

              {/* Add to Album */}
              <button
                onClick={handleAddToAlbum}
                disabled={isLoading}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <span>📁</span>
                <span>Add to Album</span>
              </button>

              {/* Tag Person */}
              <button
                onClick={handleTagPerson}
                disabled={isLoading || tagLoading}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <span>👤</span>
                <span>Tag Person</span>
              </button>

              {/* Delete */}
              <button
                onClick={handleDelete}
                disabled={isLoading}
                className="px-3 py-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <span>🗑️</span>
                <span>Delete</span>
              </button>

              {/* Clear Selection */}
              <button
                onClick={onClear}
                className="px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
              <div className="flex items-center space-x-2 text-gray-600">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                <span className="text-sm">Processing...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Person Tag Picker Dialog */}
      {showTagPicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="relative">
            <PersonTagPicker
              onSelect={handleSelectPerson}
              onCreateNew={() => {
                // Can't create new person from bulk action without a face
                setShowTagPicker(false);
              }}
              onCancel={() => setShowTagPicker(false)}
            />
            {tagLoading && (
              <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center rounded-lg">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}