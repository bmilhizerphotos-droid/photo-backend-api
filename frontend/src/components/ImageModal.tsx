import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Photo, Person, Tag, fetchPhotoTaggedPeople, fetchPhotoFaces, fetchPhotoTags, fetchTags, addTagToPhoto, removeTagFromPhoto } from '../api';
import { FaceTagModal } from './FaceTagModal';

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
  onPrevious?: () => void;
  onNext?: () => void;
}

export function ImageModal({ photo, imageUrl, loading, onClose, onPrevious, onNext }: ImageModalProps) {
  const [taggedPeople, setTaggedPeople] = useState<Person[]>([]);
  const [faceCount, setFaceCount] = useState(0);
  const [showTagModal, setShowTagModal] = useState(false);
  const [loadingPeople, setLoadingPeople] = useState(false);

  // Tags state
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagLoading, setTagLoading] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Load tagged people and tags when photo changes
  useEffect(() => {
    if (!photo) {
      setTaggedPeople([]);
      setFaceCount(0);
      setTags([]);
      return;
    }

    const loadData = async () => {
      setLoadingPeople(true);
      try {
        const [people, faces, photoTags] = await Promise.all([
          fetchPhotoTaggedPeople(photo.id),
          fetchPhotoFaces(photo.id),
          fetchPhotoTags(photo.id),
        ]);
        setTaggedPeople(people);
        setFaceCount(faces.length);
        setTags(photoTags);
      } catch (err) {
        console.error('Failed to load photo data:', err);
      } finally {
        setLoadingPeople(false);
      }
    };

    loadData();
  }, [photo]);

  // Focus tag input when shown
  useEffect(() => {
    if (showTagInput && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [showTagInput]);

  // Load tag suggestions when input changes
  useEffect(() => {
    if (!tagInput.trim()) {
      setTagSuggestions([]);
      return;
    }

    const loadSuggestions = async () => {
      try {
        const suggestions = await fetchTags('user', tagInput);
        // Filter out already applied tags
        const tagIds = new Set(tags.map(t => t.id));
        setTagSuggestions(suggestions.filter(s => !tagIds.has(s.id)));
      } catch (err) {
        console.error('Failed to load tag suggestions:', err);
      }
    };

    const debounce = setTimeout(loadSuggestions, 200);
    return () => clearTimeout(debounce);
  }, [tagInput, tags]);

  // Handle keyboard navigation (Escape, left/right arrows)
  useEffect(() => {
    if (!photo) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (showTagModal) return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          onPrevious?.();
          break;
        case 'ArrowRight':
          onNext?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [photo, onClose, onPrevious, onNext, showTagModal]);

  const handleTagUpdate = useCallback(async () => {
    if (!photo) return;
    // Reload tagged people and tags
    try {
      const [people, faces, photoTags] = await Promise.all([
        fetchPhotoTaggedPeople(photo.id),
        fetchPhotoFaces(photo.id),
        fetchPhotoTags(photo.id),
      ]);
      setTaggedPeople(people);
      setFaceCount(faces.length);
      setTags(photoTags);
    } catch (err) {
      console.error('Failed to reload photo data:', err);
    }
  }, [photo]);

  // Add a tag to the photo
  const handleAddTag = useCallback(async (tagName: string) => {
    if (!photo || !tagName.trim()) return;

    setTagLoading(true);
    try {
      const result = await addTagToPhoto(photo.id, tagName.trim(), 'user');
      if (result.tag) {
        setTags(prev => [...prev, result.tag]);
      }
      setTagInput('');
      setShowTagInput(false);
      setTagSuggestions([]);
    } catch (err) {
      console.error('Failed to add tag:', err);
    } finally {
      setTagLoading(false);
    }
  }, [photo]);

  // Select a suggested tag
  const handleSelectSuggestion = useCallback(async (tag: Tag) => {
    if (!photo) return;

    setTagLoading(true);
    try {
      await addTagToPhoto(photo.id, tag.id, 'user');
      setTags(prev => [...prev, tag]);
      setTagInput('');
      setShowTagInput(false);
      setTagSuggestions([]);
    } catch (err) {
      console.error('Failed to add tag:', err);
    } finally {
      setTagLoading(false);
    }
  }, [photo]);

  // Remove a tag from the photo
  const handleRemoveTag = useCallback(async (tagId: number) => {
    if (!photo) return;

    try {
      await removeTagFromPhoto(photo.id, tagId);
      setTags(prev => prev.filter(t => t.id !== tagId));
    } catch (err) {
      console.error('Failed to remove tag:', err);
    }
  }, [photo]);

  // Handle tag input keydown
  const handleTagKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      handleAddTag(tagInput);
    } else if (e.key === 'Escape') {
      setShowTagInput(false);
      setTagInput('');
      setTagSuggestions([]);
    }
  }, [tagInput, handleAddTag]);

  if (!photo) return null;

  return (
    <>
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
                className="w-full h-auto max-h-[80vh] object-contain"
              />

              {/* Tags and Actions */}
              <div className="p-4 bg-white border-t border-gray-200">
                {/* Tags Section */}
                <div className="mb-3">
                  <div className="flex items-center flex-wrap gap-2">
                    {/* Person tags (from face recognition) */}
                    {taggedPeople.map((person) => (
                      <span
                        key={`person-${person.id}`}
                        className="inline-flex items-center px-3 py-1 bg-purple-100 text-purple-800 text-sm rounded-full"
                      >
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                        </svg>
                        {person.name}
                      </span>
                    ))}

                    {/* User and AI tags */}
                    {tags.map((tag) => (
                      <span
                        key={`tag-${tag.id}`}
                        className={`inline-flex items-center px-3 py-1 text-sm rounded-full group ${
                          tag.type === 'ai'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {tag.type === 'ai' && (
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM5.293 7.293a1 1 0 011.414 0L9 9.586l2.293-2.293a1 1 0 111.414 1.414L10.414 11l2.293 2.293a1 1 0 01-1.414 1.414L9 12.414l-2.293 2.293a1 1 0 01-1.414-1.414L7.586 11 5.293 8.707a1 1 0 010-1.414z" />
                          </svg>
                        )}
                        {tag.name}
                        <button
                          onClick={() => handleRemoveTag(tag.id)}
                          className="ml-1 opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}

                    {/* Add tag input */}
                    {showTagInput ? (
                      <div className="relative">
                        <input
                          ref={tagInputRef}
                          type="text"
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={handleTagKeyDown}
                          placeholder="Type tag name..."
                          className="px-3 py-1 text-sm border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
                          disabled={tagLoading}
                        />
                        {tagSuggestions.length > 0 && (
                          <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                            {tagSuggestions.map((suggestion) => (
                              <button
                                key={suggestion.id}
                                onClick={() => handleSelectSuggestion(suggestion)}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                              >
                                {suggestion.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowTagInput(true)}
                        className="inline-flex items-center px-3 py-1 text-sm text-gray-500 border border-dashed border-gray-300 rounded-full hover:border-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add tag
                      </button>
                    )}
                  </div>
                </div>

                {/* Actions Row */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <div className="text-sm text-gray-500">
                    {faceCount > 0 && (
                      <span>{faceCount} face{faceCount !== 1 ? 's' : ''} detected</span>
                    )}
                  </div>

                  {/* Tag People button */}
                  <button
                    onClick={() => setShowTagModal(true)}
                    disabled={loadingPeople}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                    <span>Tag People</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Face Tag Modal */}
      {showTagModal && photo && (
        <FaceTagModal
          photo={photo}
          imageUrl={imageUrl}
          onClose={() => setShowTagModal(false)}
          onUpdate={handleTagUpdate}
        />
      )}
    </>
  );
}
