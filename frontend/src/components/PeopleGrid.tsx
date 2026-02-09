import React, { useEffect, useState } from "react";
import type { Person } from "../api";
import { fetchUnidentifiedCount } from "../api";


type Props = {
  people: Person[];
  onPersonClick?: (person: Person) => void;
  onUnidentifiedClick?: () => void;
  loading?: boolean;
};

export function PeopleGrid({
  people,
  onPersonClick,
  onUnidentifiedClick,
  loading = false,
}: Props) {
  const [unidentifiedCount, setUnidentifiedCount] = useState<{
    photoCount: number;
    faceCount: number;
  } | null>(null);

  useEffect(() => {
    fetchUnidentifiedCount()
      .then(setUnidentifiedCount)
      .catch(() => setUnidentifiedCount(null));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-gray-500">
        Loading people…
      </div>
    );
  }

  if (people.length === 0 && (!unidentifiedCount || unidentifiedCount.photoCount === 0)) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-6xl mb-4">👥</div>
        <p>No people found yet.</p>
        <p className="text-sm mt-2">
          People will appear here once photos are processed.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {unidentifiedCount && unidentifiedCount.photoCount > 0 && (
        <button
          onClick={onUnidentifiedClick}
          className="group bg-gradient-to-br from-yellow-400 to-orange-500 rounded-xl overflow-hidden shadow"
        >
          <div className="aspect-square flex items-center justify-center text-white text-6xl">
            ?
          </div>
          <div className="p-3 bg-white text-center">
            <div className="font-medium">Unidentified</div>
            <div className="text-sm text-gray-500">
              {unidentifiedCount.faceCount} faces in{" "}
              {unidentifiedCount.photoCount} photos
            </div>
          </div>
        </button>
      )}

      {people.map((person) => (
        <button
          key={person.id}
          onClick={() => onPersonClick?.(person)}
          className="group bg-white rounded-xl overflow-hidden shadow hover:shadow-md transition"
        >
          <div className="aspect-square bg-gray-100">
            {person.thumbnailUrl ? (
              <img
                src={person.thumbnailUrl}
                alt={person.name}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 text-5xl">
                👤
              </div>
            )}
          </div>
          <div className="p-3 text-center">
            <div className="font-medium truncate">{person.name}</div>
            <div className="text-sm text-gray-500">
              {person.photoCount} photos
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
