import React, { useState, useEffect, useCallback, useRef } from 'react';
import { searchPeople, fetchPeople, Person } from '../api';

interface PersonTagPickerProps {
  onSelect: (person: Person) => void;
  onCreateNew: (name: string) => void;
  onCancel: () => void;
  excludeIds?: number[];
}

export function PersonTagPicker({ onSelect, onCreateNew, onCancel, excludeIds = [] }: PersonTagPickerProps) {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load initial people list
  useEffect(() => {
    const loadPeople = async () => {
      setLoading(true);
      try {
        const data = await fetchPeople();
        setPeople(data.filter(p => !excludeIds.includes(p.id)));
      } catch (err) {
        console.error('Failed to load people:', err);
      } finally {
        setLoading(false);
      }
    };
    loadPeople();
  }, [excludeIds]);

  // Search on query change with debounce
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      // Reset to full list
      fetchPeople()
        .then(data => setPeople(data.filter(p => !excludeIds.includes(p.id))))
        .catch(console.error);
      setShowCreateNew(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchPeople(query);
        const filtered = results.filter(p => !excludeIds.includes(p.id));
        setPeople(filtered);
        // Show "create new" option if no exact match
        const exactMatch = filtered.some(p => p.name.toLowerCase() === query.toLowerCase());
        setShowCreateNew(!exactMatch && query.trim().length >= 2);
      } catch (err) {
        console.error('Failed to search people:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, excludeIds]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  }, [onCancel]);

  return (
    <div className="bg-white rounded-lg shadow-xl w-80 max-h-96 flex flex-col" onKeyDown={handleKeyDown}>
      {/* Search input */}
      <div className="p-3 border-b">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or create person..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* People list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            {/* Create new option */}
            {showCreateNew && (
              <button
                onClick={() => onCreateNew(query.trim())}
                className="w-full px-4 py-3 flex items-center space-x-3 hover:bg-blue-50 text-left border-b"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-blue-600">Create "{query.trim()}"</div>
                  <div className="text-sm text-gray-500">Add as new person</div>
                </div>
              </button>
            )}

            {/* People list */}
            {people.length === 0 && !showCreateNew ? (
              <div className="py-8 text-center text-gray-500">
                {query ? 'No people found' : 'No people available'}
              </div>
            ) : (
              people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => onSelect(person)}
                  className="w-full px-4 py-3 flex items-center space-x-3 hover:bg-gray-50 text-left"
                >
                  {/* Thumbnail */}
                  <div className="w-10 h-10 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                    {person.thumbnailUrl ? (
                      <img
                        src={person.thumbnailUrl}
                        alt={person.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

                  {/* Name and photo count */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{person.name}</div>
                    <div className="text-sm text-gray-500">
                      {person.photoCount} {person.photoCount === 1 ? 'photo' : 'photos'}
                    </div>
                  </div>
                </button>
              ))
            )}
          </>
        )}
      </div>

      {/* Cancel button */}
      <div className="p-3 border-t">
        <button
          onClick={onCancel}
          className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
