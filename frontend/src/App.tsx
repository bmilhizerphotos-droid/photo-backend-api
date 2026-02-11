import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPhotos,
  fetchAlbums,
  fetchPeople,
  fetchPersonPhotos,
  searchPhotos,
  Photo,
  Album,
  Person,
} from "./api";
import { useInfinitePhotos } from "./hooks/useInfinitePhotos";
import { useIntersectionSentinel } from "./hooks/useIntersectionSentinel";

import { PhotoMasonry } from "./components/PhotoMasonry";
import { PeopleGrid } from "./components/PeopleGrid";
import Sidebar, { AppView } from "./components/Sidebar";
import { ImageModal } from "./components/ImageModal";

export default function App() {
  const [view, setView] = useState<AppView>("photos");

  const [albums, setAlbums] = useState<Album[]>([]);

  const [people, setPeople] = useState<Person[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);

  const [personPhotos, setPersonPhotos] = useState<Photo[]>([]);
  const [personPhotosLoading, setPersonPhotosLoading] = useState(false);
  const [activePerson, setActivePerson] = useState<Person | null>(null);

  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);

  // 🔍 Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Photo[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Infinite-scroll photos
  const {
    photos,
    hasMore,
    loading: photosLoading,
    loadMore,
  } = useInfinitePhotos(fetchPhotos, 50);

  const searching = view === "photos" && searchQuery.trim().length > 0;

  const sentinelRef = useIntersectionSentinel({
    enabled: view === "photos" && !searching && hasMore && !photosLoading,
    onIntersect: loadMore,
  });

  // Load albums (sidebar) on mount
  useEffect(() => {
    fetchAlbums().then(setAlbums).catch(() => setAlbums([]));
  }, []);

  // Load "People" when view is people
  useEffect(() => {
    if (view !== "people") return;

    let cancelled = false;
    setPeopleLoading(true);

    fetchPeople()
      .then((data) => {
        if (cancelled) return;
        setPeople(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setPeople([]);
      })
      .finally(() => {
        if (cancelled) return;
        setPeopleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [view]);

  // 🔍 Run search when query changes
  useEffect(() => {
    if (!searching) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);

    searchPhotos(searchQuery)
      .then((photos) => {
        if (cancelled) return;
        setSearchResults(photos);
      })
      .catch(() => {
        if (cancelled) return;
        setSearchResults([]);
      })
      .finally(() => {
        setSearchLoading((prev) => (cancelled ? prev : false));
      });

    return () => {
      cancelled = true;
    };
  }, [searchQuery, searching]);

  const openPhoto = useCallback((p: Photo) => {
    const url = (p as any)?.image_url;
    if (typeof url === "string" && url.length > 0) {
      setModalImageUrl(url);
    }
  }, []);

  const loadPerson = useCallback(async (person: Person) => {
    setActivePerson(person);
    setView("person-detail");

    setPersonPhotos([]);
    setPersonPhotosLoading(true);

    try {
      const data = await fetchPersonPhotos(person.id);
      setPersonPhotos(Array.isArray(data) ? data : []);
    } catch {
      setPersonPhotos([]);
    } finally {
      setPersonPhotosLoading(false);
    }
  }, []);

  const header = useMemo(() => {
    if (view === "person-detail" && activePerson) {
      return (
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            className="text-sm text-blue-600 hover:underline"
            onClick={() => {
              setActivePerson(null);
              setPersonPhotos([]);
              setView("people");
            }}
          >
            ← Back to People
          </button>
          <div className="text-lg font-semibold text-gray-900">
            {activePerson.name}
          </div>
          <div className="w-[110px]" />
        </div>
      );
    }

    if (view === "photos") {
      return (
        <div className="mb-4">
          <div className="text-xl font-semibold mb-2">Photos</div>
          <input
            type="text"
            placeholder="Search photos (e.g. dog, beach, birthday)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full max-w-md px-3 py-2 border rounded-md text-sm"
          />
        </div>
      );
    }

    if (view === "people") {
      return <div className="text-xl font-semibold mb-4">People</div>;
    }

    return null;
  }, [view, activePerson, searchQuery]);

  const renderView = () => {
    if (view === "photos") {
      if (searching) {
        if (searchLoading) {
          return <div className="text-gray-500">Searching…</div>;
        }
        return (
          <PhotoMasonry
            photos={searchResults}
            onPhotoClick={(p) => openPhoto(p)}
          />
        );
      }

      if (photosLoading && photos.length === 0) {
        return <div className="text-gray-500">Loading photos…</div>;
      }

      return (
        <>
          <PhotoMasonry photos={photos} onPhotoClick={(p) => openPhoto(p)} />
          <div ref={sentinelRef} className="h-10" />
        </>
      );
    }

    if (view === "people") {
      return (
        <PeopleGrid
          people={people}
          onPersonClick={loadPerson}
          loading={peopleLoading}
        />
      );
    }

    if (view === "person-detail" && activePerson) {
      if (personPhotosLoading) {
        return <div className="text-gray-500">Loading photos…</div>;
      }
      return (
        <PhotoMasonry
          photos={personPhotos}
          onPhotoClick={(p) => openPhoto(p)}
        />
      );
    }

    return <div className="text-gray-400">Select a view</div>;
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar
        view={view}
        onChangeView={(v) => {
          if (v !== "person-detail") {
            setActivePerson(null);
            setPersonPhotos([]);
          }
          setView(v);
        }}
        albums={albums}
        selectedAlbumId={null}
        onSelectAlbum={() => {}}
        onCreateAlbum={() => {}}
      />

      <main className="flex-1 p-4 overflow-y-auto">
        {header}
        {renderView()}
      </main>

      <ImageModal
        imageUrl={modalImageUrl}
        onClose={() => setModalImageUrl(null)}
      />
    </div>
  );
}
