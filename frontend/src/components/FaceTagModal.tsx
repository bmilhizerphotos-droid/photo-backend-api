import React, { useState, useEffect, useCallback } from 'react';
import {
  Photo,
  Face,
  Person,
  fetchPhotoFaces,
  fetchPhotoTaggedPeople,
  identifyFace,
  createPersonFromFace,
  tagPersonInPhoto,
  removePersonTagFromPhoto,
} from '../api';
import { PersonTagPicker } from './PersonTagPicker';

interface FaceTagModalProps {
  photo: Photo;
  imageUrl: string;
  onClose: () => void;
  onUpdate?: () => void;
}

export function FaceTagModal({ photo, imageUrl, onClose, onUpdate }: FaceTagModalProps) {
  const [faces, setFaces] = useState<Face[]>([]);
  const [taggedPeople, setTaggedPeople] = useState<Person[]>([]);
  const [selectedFace, setSelectedFace] = useState<Face | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showManualTag, setShowManualTag] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load faces and tagged people on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [facesData, peopleData] = await Promise.all([
          fetchPhotoFaces(photo.id),
          fetchPhotoTaggedPeople(photo.id),
        ]);
        setFaces(facesData);
        setTaggedPeople(peopleData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load face data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [photo.id]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPicker || showManualTag) {
          setShowPicker(false);
          setShowManualTag(false);
          setSelectedFace(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showPicker, showManualTag]);

  const handleFaceClick = useCallback((face: Face) => {
    if (face.personId) return; // Already identified
    setSelectedFace(face);
    setShowPicker(true);
  }, []);

  const handleSelectPerson = useCallback(async (person: Person) => {
    if (!selectedFace) return;

    setSaving(true);
    try {
      await identifyFace(selectedFace.id, person.id);

      // Update local state
      setFaces(prev => prev.map(f =>
        f.id === selectedFace.id
          ? { ...f, personId: person.id, personName: person.name }
          : f
      ));

      // Add to tagged people if not already there
      if (!taggedPeople.some(p => p.id === person.id)) {
        setTaggedPeople(prev => [...prev, person]);
      }

      setShowPicker(false);
      setSelectedFace(null);
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to identify face');
    } finally {
      setSaving(false);
    }
  }, [selectedFace, taggedPeople, onUpdate]);

  const handleCreatePerson = useCallback(async (name: string) => {
    if (!selectedFace) return;

    setSaving(true);
    try {
      const result = await createPersonFromFace(selectedFace.id, name);

      // Update local state
      setFaces(prev => prev.map(f =>
        f.id === selectedFace.id
          ? { ...f, personId: result.person.id, personName: result.person.name }
          : f
      ));

      setTaggedPeople(prev => [...prev, result.person]);

      setShowPicker(false);
      setSelectedFace(null);
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create person');
    } finally {
      setSaving(false);
    }
  }, [selectedFace, onUpdate]);

  const handleManualTag = useCallback(async (person: Person) => {
    setSaving(true);
    try {
      await tagPersonInPhoto(photo.id, person.id);

      if (!taggedPeople.some(p => p.id === person.id)) {
        setTaggedPeople(prev => [...prev, person]);
      }

      setShowManualTag(false);
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to tag person');
    } finally {
      setSaving(false);
    }
  }, [photo.id, taggedPeople, onUpdate]);

  const handleRemoveTag = useCallback(async (personId: number) => {
    setSaving(true);
    try {
      await removePersonTagFromPhoto(photo.id, personId);

      setTaggedPeople(prev => prev.filter(p => p.id !== personId));

      // Also update face if it was linked to this person
      setFaces(prev => prev.map(f =>
        f.personId === personId
          ? { ...f, personId: null, personName: null }
          : f
      ));

      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove tag');
    } finally {
      setSaving(false);
    }
  }, [photo.id, onUpdate]);

  const unidentifiedCount = faces.filter(f => !f.personId).length;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Tag People</h2>
            <p className="text-sm text-gray-500">
              {faces.length > 0
                ? `${faces.length} face${faces.length !== 1 ? 's' : ''} detected${unidentifiedCount > 0 ? `, ${unidentifiedCount} unidentified` : ''}`
                : 'No faces detected'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-200">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Image with face overlays */}
              <div className="flex-1 relative">
                <div className="relative inline-block">
                  <img
                    src={imageUrl}
                    alt={photo.filename}
                    className="max-w-full max-h-[60vh] object-contain rounded-lg"
                  />

                  {/* Face bounding boxes */}
                  {faces.map((face) => (
                    <button
                      key={face.id}
                      onClick={() => handleFaceClick(face)}
                      disabled={!!face.personId || saving}
                      className={`absolute border-2 rounded transition-all ${
                        face.personId
                          ? 'border-green-500 cursor-default'
                          : selectedFace?.id === face.id
                          ? 'border-blue-500 bg-blue-500 bg-opacity-20'
                          : 'border-yellow-500 hover:border-blue-500 hover:bg-blue-500 hover:bg-opacity-10 cursor-pointer'
                      }`}
                      style={{
                        left: `${face.bbox.x * 100}%`,
                        top: `${face.bbox.y * 100}%`,
                        width: `${face.bbox.width * 100}%`,
                        height: `${face.bbox.height * 100}%`,
                      }}
                      title={face.personName || 'Click to identify'}
                    >
                      {/* Name label */}
                      {face.personName && (
                        <div className="absolute -bottom-6 left-0 right-0 text-center">
                          <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded">
                            {face.personName}
                          </span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                {/* Help text */}
                {unidentifiedCount > 0 && (
                  <p className="mt-4 text-sm text-gray-500 text-center">
                    Click on a yellow box to identify that face
                  </p>
                )}
              </div>

              {/* Tagged people sidebar */}
              <div className="lg:w-64 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-gray-900">Tagged People</h3>
                  <button
                    onClick={() => setShowManualTag(true)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    + Add
                  </button>
                </div>

                {taggedPeople.length === 0 ? (
                  <p className="text-sm text-gray-500">No one tagged yet</p>
                ) : (
                  <ul className="space-y-2">
                    {taggedPeople.map((person) => (
                      <li
                        key={person.id}
                        className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center space-x-2">
                          <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden">
                            {person.thumbnailUrl ? (
                              <img
                                src={person.thumbnailUrl}
                                alt={person.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                  />
                                </svg>
                              </div>
                            )}
                          </div>
                          <span className="text-sm font-medium text-gray-900">{person.name}</span>
                        </div>
                        <button
                          onClick={() => handleRemoveTag(person.id)}
                          disabled={saving}
                          className="text-gray-400 hover:text-red-500 disabled:opacity-50"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Person picker overlay for face identification */}
        {showPicker && selectedFace && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-10">
            <PersonTagPicker
              onSelect={handleSelectPerson}
              onCreateNew={handleCreatePerson}
              onCancel={() => {
                setShowPicker(false);
                setSelectedFace(null);
              }}
              excludeIds={taggedPeople.map(p => p.id)}
            />
          </div>
        )}

        {/* Person picker overlay for manual tagging */}
        {showManualTag && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-10">
            <PersonTagPicker
              onSelect={handleManualTag}
              onCreateNew={async (name) => {
                // For manual tag without face, we need to create the person differently
                // We'll just tag them manually after creating
                setSaving(true);
                try {
                  // Create via the regular people API would be ideal, but for now
                  // we'll just show an error since we need a face to create a person
                  setError('To create a new person, please click on a detected face');
                  setShowManualTag(false);
                } finally {
                  setSaving(false);
                }
              }}
              onCancel={() => setShowManualTag(false)}
              excludeIds={taggedPeople.map(p => p.id)}
            />
          </div>
        )}

        {/* Saving overlay */}
        {saving && (
          <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-20">
            <div className="flex items-center space-x-2 text-gray-600">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span>Saving...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
