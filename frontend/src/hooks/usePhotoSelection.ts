import { useState, useCallback } from 'react';
import { Photo } from '../api';

interface UsePhotoSelectionReturn {
  selectedIds: Set<number>;
  selectMode: boolean;
  toggleSelection: (photoId: number, event?: React.MouseEvent) => void;
  clearSelection: () => void;
  selectAll: (photos: Photo[]) => void;
}

export function usePhotoSelection(photos: Photo[]): UsePhotoSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);

  const toggleSelection = useCallback((photoId: number, event?: React.MouseEvent) => {
    const isCtrlPressed = event?.ctrlKey || event?.metaKey;
    const isShiftPressed = event?.shiftKey;

    if (isShiftPressed && lastSelectedId !== null) {
      // Range selection
      const allPhotoIds = photos.map(p => p.id);
      const currentIndex = allPhotoIds.indexOf(photoId);
      const lastIndex = allPhotoIds.indexOf(lastSelectedId);

      if (currentIndex !== -1 && lastIndex !== -1) {
        const startIndex = Math.min(currentIndex, lastIndex);
        const endIndex = Math.max(currentIndex, lastIndex);
        const rangeIds = allPhotoIds.slice(startIndex, endIndex + 1);

        setSelectedIds(prev => new Set([...prev, ...rangeIds]));
        setSelectMode(true);
      }
    } else if (isCtrlPressed) {
      // Toggle individual selection
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(photoId)) {
          newSet.delete(photoId);
        } else {
          newSet.add(photoId);
        }
        return newSet;
      });
      setSelectMode(true);
    } else {
      // Single selection (checkbox clicks) - replace all
      setSelectedIds(new Set([photoId]));
      setSelectMode(true);
    }

    setLastSelectedId(photoId);
  }, [lastSelectedId, photos]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setSelectMode(false);
  }, []);

  const selectAll = useCallback((photos: Photo[]) => {
    setSelectedIds(new Set(photos.map(p => p.id)));
    setSelectMode(true);
  }, []);

  return {
    selectedIds,
    selectMode,
    toggleSelection,
    clearSelection,
    selectAll,
  };
}
