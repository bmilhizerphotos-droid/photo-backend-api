import React, { useEffect, useState, useCallback } from "react";
import {
  Photo,
  Person,
  fetchPhotoTaggedPeople,
  tagPersonInPhoto,
  removePersonTagFromPhoto,
} from "../api";
import { PersonTagPicker } from "./PersonTagPicker";

interface ImageModalProps {
  photo: Photo | null;
  onClose: () => void;
}

export function ImageModal({ photo, onClose }: ImageModalProps) {
  const [taggedPeople, setTaggedPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!photo) return;
    const loadTags = async () => {
      setLoading(true);
      setError(null);
      try {
        const people = await fetchPhotoTaggedPeople(photo.id);
        setTaggedPeople(people);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tags");
      } finally {
        setLoading(false);
      }
    };
    loadTags();
  }, [photo]);

  useEffect(() => {
    if (!photo) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pickerOpen) {
          setPickerOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [photo, pickerOpen, onClose]);

  const handleAddTag = useCallback(
    async (person: Person) => {
      if (!photo) return;
      setProcessing(true);
      try {
        await tagPersonInPhoto(photo.id, person.id);
        setTaggedPeople((prev) => [...prev.filter((p) => p.id !== person.id), person]);
        setPickerOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to tag person");
      } finally {
        setProcessing(false);
      }
    },
    [photo]
  );

  const handleRemoveTag = useCallback(
    async (personId: number) => {
      if (!photo) return;
      setProcessing(true);
      try {
        await removePersonTagFromPhoto(photo.id, personId);
        setTaggedPeople((prev) => prev.filter((p) => p.id !== personId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove tag");
      } finally {
        setProcessing(false);
      }
    },
    [photo]
  );

  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh] w-full rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={photo.image_url}
          alt={photo.filename}
          className="w-full h-auto max-h-[80vh] object-contain rounded-t-lg shadow-2xl"
          loading="eager"
          decoding="async"
        />
        <div className="bg-white rounded-b-lg border border-t-0 p-4 max-h-[15vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Tagged People</h3>
            <button
              onClick={() => setPickerOpen(true)}
              disabled={processing}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Add Tag
            </button>
          </div>
          {loading ? (
            <p className="text-xs text-gray-500">Loading tags…</p>
          ) : taggedPeople.length === 0 ? (
            <p className="text-xs text-gray-500">No tags yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {taggedPeople.map((person) => (
                <li
                  key={person.id}
                  className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                >
                  <span>{person.name}</span>
                  <button
                    onClick={() => handleRemoveTag(person.id)}
                    disabled={processing}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
        {pickerOpen && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <PersonTagPicker
              onSelect={handleAddTag}
              onCreateNew={() => {
                setError("Please use the face tagging UI to create new people.");
                return Promise.reject(new Error("Create unsupported"));
              }}
              onCancel={() => setPickerOpen(false)}
              excludeIds={taggedPeople.map((p) => p.id)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
