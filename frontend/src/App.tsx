import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPhotos,
  fetchAlbums,
  fetchPeople,
  fetchPersonPhotos,
  searchPhotos,
  Photo,
  Album,
  Person,
  SearchMeta,
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

  // 🔍 Search state — input is debounced before triggering search
  const [searchInput, setSearchInput] = useState("");   // raw keystroke value
  const [searchQuery, setSearchQuery] = useState("");   // debounced, drives actual search
  const [searchResults, setSearchResults] = useState<Photo[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [searchHasMore, setSearchHasMore] = useState(false);
  // Refs so loadMoreSearch stays stable (same pattern as useInfinitePhotos)
  const searchQueryRef   = useRef("");
  const searchOffsetRef  = useRef(0);
  const searchHasMoreRef = useRef(false);
  const searchInFlight   = useRef(false);

  // Infinite-scroll photos
  const {
    photos,
    hasMore,
    loading: photosLoading,
    error: photosError,
    reset: resetPhotos,
    loadMore,
  } = useInfinitePhotos(fetchPhotos, 50);

  // Submit search (called by form onSubmit and search button)
  const submitSearch = useCallback(() => {
    setSearchQuery(searchInput.trim());
  }, [searchInput]);

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

  // 🔍 Stable "load more" — uses refs so the callback never changes identity
  const loadMoreSearch = useCallback(async () => {
    if (searchInFlight.current || !searchHasMoreRef.current) return;
    const query = searchQueryRef.current;
    if (!query) return;

    searchInFlight.current = true;
    setSearchLoadingMore(true);
    try {
      const result = await searchPhotos(query, searchOffsetRef.current);
      if (searchQueryRef.current !== query) return; // stale — query changed
      setSearchResults((prev) => [...prev, ...result.photos]);
      searchOffsetRef.current += result.photos.length;
      searchHasMoreRef.current = result.hasMore;
      setSearchHasMore(result.hasMore);
    } catch { /* ignore */ }
    finally {
      searchInFlight.current = false;
      setSearchLoadingMore(false);
    }
  }, []); // intentionally empty — reads all mutable state from refs

  const searchSentinelRef = useIntersectionSentinel({
    enabled: !!user && searching && searchHasMore && !searchLoading && !searchLoadingMore,
    onIntersect: loadMoreSearch,
  });

  // 🔍 Run first-page search when debounced query changes
  useEffect(() => {
    if (!user || !searching) {
      // Reset everything
      searchQueryRef.current = "";
      searchOffsetRef.current = 0;
      searchHasMoreRef.current = false;
      searchInFlight.current = false;
      setSearchResults([]);
      setSearchMeta(null);
      setSearchLoading(false);
      setSearchHasMore(false);
      return;
    }

    const query = searchQuery;
    // Update refs immediately so loadMoreSearch always sees current values
    searchQueryRef.current = query;
    searchOffsetRef.current = 0;
    searchHasMoreRef.current = false;
    searchInFlight.current = false;

    let cancelled = false;
    setSearchLoading(true);
    setSearchResults([]);
    setSearchMeta(null);
    setSearchHasMore(false);

    searchPhotos(query, 0)
      .then((result) => {
        if (cancelled || searchQueryRef.current !== query) return;
        setSearchResults(result.photos);
        setSearchMeta(result.meta);
        searchOffsetRef.current = result.photos.length;
        searchHasMoreRef.current = result.hasMore;
        setSearchHasMore(result.hasMore);
      })
      .catch(() => {
        if (cancelled || searchQueryRef.current !== query) return;
        setSearchResults([]);
        setSearchMeta(null);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });

    return () => { cancelled = true; };
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
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => { e.preventDefault(); submitSearch(); }}
        >
          <input
            type="text"
            placeholder='Search photos…'
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-full text-sm bg-gray-100 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
          />
          {searchInput.trim() && (
            <button
              type="button"
              onClick={() => { setSearchInput(""); setSearchQuery(""); }}
              className="px-3 py-2 text-gray-400 hover:text-gray-600 text-lg leading-none"
              title="Clear"
            >
              ✕
            </button>
          )}
          <button
            type="submit"
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-full transition-colors"
          >
            Search
          </button>
        </form>
      );
    }

    if (view === "people") {
      return <div className="text-xl font-semibold mb-4">People</div>;
    }

    return null;
  }, [view, activePerson, searchInput, submitSearch]);

  const renderView = () => {
    if (view === "photos") {
      if (searching) {
        if (searchLoading) {
          return (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              <span className="text-sm">Searching with AI…</span>
            </div>
          );
        }

        const metaBadges: string[] = [];
        if (searchMeta?.personName) metaBadges.push(`👤 ${searchMeta.personName}`);
        if (searchMeta?.dateRange) {
          const { start, end } = searchMeta.dateRange;
          metaBadges.push(`📅 ${start.slice(0, 7)} – ${end.slice(0, 7)}`);
        }

        return (
          <div>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className="text-sm text-gray-500">
                {searchResults.length}{searchHasMore ? "+" : ""} result{searchResults.length !== 1 ? "s" : ""}
              </span>
              {metaBadges.map((b) => (
                <span key={b} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5">
                  {b}
                </span>
              ))}
              {searchResults.length === 0 && (
                <span className="text-sm text-gray-400">No photos found — try different words</span>
              )}
            </div>
            <PhotoMasonry
              photos={searchResults}
              onPhotoClick={(p) => openPhoto(p)}
            />
            {/* Infinite scroll sentinel for search */}
            <div ref={searchSentinelRef} className="h-10" />
            {searchLoadingMore && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              </div>
            )}
          </div>
        );
      }

      if (photosLoading && photos.length === 0) {
        return <div className="text-gray-500">Loading photos…</div>;
      }

      return (
        <>
          <PhotoMasonry photos={photos} onPhotoClick={(p) => openPhoto(p)} groupByDate />
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

    // Placeholder views for future features
    const placeholders: Partial<Record<AppView, { emoji: string; title: string; desc: string }>> = {
      documents:       { emoji: "📄", title: "Documents",               desc: "PDFs, Word docs, and other documents from your photos." },
      screenshots:     { emoji: "🖥️", title: "Screenshots & recordings", desc: "Screenshots and screen recordings will appear here." },
      favorites:       { emoji: "❤️", title: "Favorites",               desc: "Photos you've marked as favorites will appear here." },
      places:          { emoji: "🗺️", title: "Places",                  desc: "Photos grouped by location will appear here." },
      videos:          { emoji: "🎬", title: "Videos",                  desc: "Your video files will appear here." },
      "recently-added":{ emoji: "🕐", title: "Recently added",          desc: "Photos added in the last 30 days." },
      shared:          { emoji: "🔗", title: "Shared",                  desc: "Photos shared with or by you will appear here." },
      import:          { emoji: "➕", title: "Add photos",              desc: "Import new photos into your library." },
      trash:           { emoji: "🗑️", title: "Trash",                   desc: "Deleted photos are kept here for 60 days before permanent removal." },
    };

    const placeholder = placeholders[view];
    if (placeholder) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <span className="text-5xl">{placeholder.emoji}</span>
          <h2 className="text-xl font-semibold text-gray-800">{placeholder.title}</h2>
          <p className="text-sm text-gray-500 max-w-xs">{placeholder.desc}</p>
          <span className="text-xs text-gray-400 mt-2">Coming soon</span>
        </div>
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
          if (v !== "photos") {
            setSearchInput("");
            setSearchQuery("");
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
