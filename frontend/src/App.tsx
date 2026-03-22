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
import { FaceTagModal } from "./components/FaceTagModal";
import { UnidentifiedFaces } from "./components/UnidentifiedFaces";
import DuplicatesView from "./components/DuplicatesView";
import { useAuth } from "./hooks/useAuth";

export default function App() {
  const { user, loading: authLoading, error: authError, signIn, signOut } = useAuth();
  const [view, setView] = useState<AppView>("photos");

  const [albums, setAlbums] = useState<Album[]>([]);

  const [people, setPeople] = useState<Person[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);

  const [personPhotos, setPersonPhotos] = useState<Photo[]>([]);
  const [personPhotosLoading, setPersonPhotosLoading] = useState(false);
  const [activePerson, setActivePerson] = useState<Person | null>(null);
  const [selectedPhotoForTagging, setSelectedPhotoForTagging] = useState<Photo | null>(null);

  const [modalPhoto, setModalPhoto] = useState<Photo | null>(null);

  // 🔍 Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Photo[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Infinite-scroll photos
  const {
    photos,
    hasMore,
    loading: photosLoading,
    error: photosError,
    reset: resetPhotos,
    loadMore,
  } = useInfinitePhotos(fetchPhotos, 50);

  const searching = view === "photos" && searchQuery.trim().length > 0;

  const sentinelRef = useIntersectionSentinel({
    enabled: !!user && view === "photos" && !searching && hasMore && !photosLoading,
    onIntersect: loadMore,
  });

  // Load albums (sidebar) on mount
  useEffect(() => {
    if (!user) {
      setAlbums([]);
      return;
    }
    fetchAlbums().then(setAlbums).catch(() => setAlbums([]));
  }, [user]);

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
    if (!user) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
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
  }, [searchQuery, searching, user]);

  useEffect(() => {
    if (!user) {
    resetPhotos();
    setPeople([]);
    setAlbums([]);
    setPersonPhotos([]);
    setActivePerson(null);
    setModalPhoto(null);
    setSelectedPhotoForTagging(null);
      return;
    }

    resetPhotos();
    loadMore();
  }, [user, resetPhotos, loadMore]);

  const openPhoto = useCallback((p: Photo) => {
    const url = (p as any)?.image_url;
    if (typeof url === "string" && url.length > 0) {
      setModalPhoto({ ...p, image_url: url });
    }
  }, []);

  const openPhotoTagEditor = useCallback((p: Photo) => {
    setSelectedPhotoForTagging(p);
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
          onUnidentifiedClick={() => setView("unidentified")}
          loading={peopleLoading}
        />
      );
    }

    if (view === "unidentified") {
      return (
        <UnidentifiedFaces
          onBack={() => setView("people")}
        />
      );
    }

    if (view === "duplicates") {
      return <DuplicatesView />;
    }

    if (view === "person-detail" && activePerson) {
      if (personPhotosLoading) {
        return <div className="text-gray-500">Loading photos…</div>;
      }
      return (
        <PhotoMasonry
          photos={personPhotos}
          onPhotoClick={(p) => openPhotoTagEditor(p)}
        />
      );
    }

    return <div className="text-gray-400">Select a view</div>;
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Family Photos</h1>
          <p className="mt-3 text-sm text-gray-600">Checking your sign-in status...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Family Photos</h1>
          <p className="mt-3 text-sm text-gray-600">
            Sign in with Google to load your protected photo library.
          </p>
          {authError && <p className="mt-4 text-sm text-red-600">{authError}</p>}
          <button
            type="button"
            onClick={() => void signIn()}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Sign In With Google
          </button>
        </div>
      </div>
    );
  }

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
        <div className="mb-4 flex items-center justify-end gap-3">
          <div className="text-sm text-gray-500">{user.email}</div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Sign Out
          </button>
        </div>
        {header}
        {photosError && view === "photos" && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {photosError}
          </div>
        )}
        {renderView()}
      </main>

        <ImageModal
          photo={modalPhoto}
          onClose={() => setModalPhoto(null)}
        />
      {selectedPhotoForTagging && (
        <FaceTagModal
          photo={selectedPhotoForTagging}
          imageUrl={(selectedPhotoForTagging as any).image_url || (selectedPhotoForTagging as any).fullUrl}
          onClose={() => setSelectedPhotoForTagging(null)}
          onUpdate={() => {
            if (activePerson) {
              void loadPerson(activePerson);
            }
          }}
        />
      )}
    </div>
  );
}
