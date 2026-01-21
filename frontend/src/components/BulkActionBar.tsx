import React, { useState } from 'react';

type BulkAction = 'favorite' | 'unfavorite' | 'add_to_album' | 'delete';

type Props = {
  selectedCount: number;
  onAction: (action: BulkAction, albumId?: number) => Promise<void>;
  onClear: () => void;
  isLoading?: boolean;
};

export function BulkActionBar({ selectedCount, onAction, onClear, isLoading = false }: Props) {
  const [showAlbumDialog, setShowAlbumDialog] = useState(false);
  const [albumName, setAlbumName] = useState('');

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

  const handleAddToAlbum = async () => {
    setShowAlbumDialog(true);
  };

  const handleAlbumSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (albumName.trim()) {
      await onAction('add_to_album');
      setAlbumName('');
      setShowAlbumDialog(false);
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

      {/* Album Creation Dialog */}
      {showAlbumDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Create New Album</h3>
            <form onSubmit={handleAlbumSubmit}>
              <div className="mb-4">
                <label htmlFor="albumName" className="block text-sm font-medium text-gray-700 mb-2">
                  Album Name
                </label>
                <input
                  type="text"
                  id="albumName"
                  value={albumName}
                  onChange={(e) => setAlbumName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter album name"
                  autoFocus
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowAlbumDialog(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!albumName.trim() || isLoading}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Album
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}