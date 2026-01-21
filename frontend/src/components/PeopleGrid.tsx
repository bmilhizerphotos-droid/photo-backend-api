import React from "react";
import type { Person } from "../api";

type Props = {
  people: Person[];
  onPersonClick?: (person: Person) => void;
  loading?: boolean;
};

export function PeopleGrid({ people, onPersonClick, loading = false }: Props) {
  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="flex items-center space-x-2 text-gray-500">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          <span>Loading people...</span>
        </div>
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-6xl mb-4">👥</div>
        <p>No people found yet.</p>
        <p className="text-sm mt-2">People will appear here once photos are processed.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {people.map((person) => (
        <button
          key={person.id}
          onClick={() => onPersonClick?.(person)}
          className="group relative bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
        >
          {/* Thumbnail */}
          <div className="aspect-square bg-gray-100 relative">
            {person.thumbnailUrl ? (
              <img
                src={person.thumbnailUrl}
                alt={person.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <svg
                  className="w-16 h-16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
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

          {/* Name and count */}
          <div className="p-3 text-center">
            <h3 className="font-medium text-gray-900 truncate" title={person.name}>
              {person.name}
            </h3>
            <p className="text-sm text-gray-500">
              {person.photoCount} {person.photoCount === 1 ? "photo" : "photos"}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
