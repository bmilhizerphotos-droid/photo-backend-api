import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPhotos,
  fetchAlbums,
  fetchPeople,
  fetchPersonPhotos,
  fetchAlbumPhotos,
  searchPhotos,
  fetchFilterOptions,
  bulkAction,
  fetchMe,
  Photo,
  Album,
  Person,
  SearchMeta,
  SearchFilters,
  FilterOptions,
  EMPTY_FILTERS,
  hasActiveFilters,
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
import DocumentsView from "./components/DocumentsView";
import ScreenshotsView from "./components/ScreenshotsView";
import TrashView from "./components/TrashView";
import FavoritesView from "./components/FavoritesView";
import OnThisDayView from "./components/OnThisDayView";
import MapView from "./components/MapView";
import PlacesView from "./components/PlacesView";
import VideosView from "./components/VideosView";
import BirthdayBanner from "./components/BirthdayBanner";
import MemorySlideshow from "./components/MemorySlideshow";
import MemoriesGrid from "./components/MemoriesGrid";
import AlbumsGrid from "./components/AlbumsGrid";
import CreateAlbumModal from "./components/CreateAlbumModal";
import AddToAlbumModal from "./components/AddToAlbumModal";
import { BulkActionBar } from "./components/BulkActionBar";
import AdminView from "./components/AdminView";
import FilterDrawer from "./components/FilterDrawer";
import { useAuth } from "./hooks/useAuth";
import { Memory } from "./api";

const ADMIN_EMAIL = "bmilhizerphotos@gmail.com";

export default function App() {
  const { user, loading: authLoading, signingIn, error: authError, signIn, signOut } = useAuth();
  const [view, setView] = useState<AppView>("photos");
  const [isApproved, setIsApproved] = useState<boolean | null>(null);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ people: [], tags: [] });
  const searchFiltersRef = useRef<SearchFilters>(EMPTY_FILTERS);

  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumRefreshTrigger, setAlbumRefreshTrigger] = useState(0);

  // Album detail
  const [activeAlbum, setActiveAlbum] = useState<{ id: number; name: string; description?: string | null } | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<Photo[]>([]);
  const [albumPhotosLoading, setAlbumPhotosLoading] = useState(false);
  const [albumPhotosHasMore, setAlbumPhotosHasMore] = useState(false);
  const albumPhotosOffsetRef = useRef(0);
  const albumPhotosHasMoreRef = useRef(false);
  const albumPhotosInFlight = useRef(false);

  // Album modals
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false);
  const [showAddToAlbumModal, setShowAddToAlbumModal] = useState(false);

  const [people, setPeople] = useState<Person[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);

  const [personPhotos, setPersonPhotos] = useState<Photo[]>([]);
  const [personPhotosLoading, setPersonPhotosLoading] = useState(false);
  const [activePerson, setActivePerson] = useState<Person | null>(null);
  const [selectedPhotoForTagging, setSelectedPhotoForTagging] = useState<Photo | null>(null);

  const [modalPhoto, setModalPhoto] = useState<Photo | null>(null);

  // Scroll container ref — passed as root to IntersectionObserver so infinite scroll
  // works when <main> is the scroll container (not the viewport)
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);

  // Memory slideshow
  const [slideshowMemory, setSlideshowMemory] = useState<Memory | null>(null);

  // Selection state for gallery
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectModeActive, setSelectModeActive] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const selectMode = selectModeActive || selectedIds.size > 0;

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

  const searching = view === "photos" && (searchQuery.trim().length > 0 || hasActiveFilters(filters));

  const sentinelRef = useIntersectionSentinel({
    enabled: !!user && view === "photos" && !searching && hasMore && !photosLoading,
    onIntersect: loadMore,
    root: mainEl,
  });

  // Load albums (sidebar) on mount
  useEffect(() => {
    if (!user) {
      setAlbums([]);
      return;
    }
    fetchAlbums().then(setAlbums).catch(() => setAlbums([]));
  }, [user]);

  // Load filter options (people + tags) once when user authenticates
  useEffect(() => {
    if (!user) { setFilterOptions({ people: [], tags: [] }); return; }
    fetchFilterOptions().then(setFilterOptions).catch(() => {});
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
      const result = await searchPhotos(query, searchOffsetRef.current, 50, searchFiltersRef.current);
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
    root: mainEl,
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
    searchFiltersRef.current = filters;
    searchOffsetRef.current = 0;
    searchHasMoreRef.current = false;
    searchInFlight.current = false;

    let cancelled = false;
    setSearchLoading(true);
    setSearchResults([]);
    setSearchMeta(null);
    setSearchHasMore(false);

    searchPhotos(query, 0, 50, filters)
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
  }, [searchQuery, filters, searching, user]);

  useEffect(() => {
    if (!user) {
      setIsApproved(null);
      setApprovalChecked(false);
      setIsAdmin(false);
      return;
    }
    fetchMe()
      .then((data) => {
        console.log("Current User Status:", data);
        setIsApproved(data.isApproved);
        setApprovalChecked(true);
        setIsAdmin(data.isAdmin === true);
      })
      .catch((err) => {
        console.error("fetchMe failed:", err);
        const adminFallback = (user.email ?? '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
        setIsApproved(adminFallback);
        setApprovalChecked(true);
        setIsAdmin(adminFallback);
      });
  }, [user]);

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

  const openPhoto = useCallback((p: Photo, e?: React.MouseEvent) => {
    // In select mode, or ctrl/cmd+click → toggle selection
    if (selectModeActive || selectedIds.size > 0 || e?.ctrlKey || e?.metaKey) {
      setSelectModeActive(true);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.has(p.id) ? next.delete(p.id) : next.add(p.id);
        return next;
      });
      return;
    }
    const url = (p as any)?.image_url;
    if (typeof url === "string" && url.length > 0) {
      setModalPhoto({ ...p, image_url: url });
    }
  }, [selectModeActive, selectedIds.size]);

  const handleBulkAction = useCallback(async (action: string) => {
    if (action === 'add_to_album') {
      setShowAddToAlbumModal(true);
      return;
    }
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBulkLoading(true);
    try {
      await bulkAction(action, ids);
      setSelectedIds(new Set());
      setSelectModeActive(false);
      // Reflect changes in local photos list without a full reload
      if (action === 'favorite') {
        resetPhotos();
        loadMore();
      } else if (action === 'unfavorite') {
        resetPhotos();
        loadMore();
      }
    } catch (err) {
      console.error('Bulk action failed', err);
    } finally {
      setBulkLoading(false);
    }
  }, [selectedIds, resetPhotos, loadMore]);

  const openPhotoTagEditor = useCallback((p: Photo) => {
    setSelectedPhotoForTagging(p);
  }, []);

  const loadAlbum = useCallback(async (albumId: number) => {
    albumPhotosOffsetRef.current = 0;
    albumPhotosHasMoreRef.current = false;
    albumPhotosInFlight.current = false;
    setAlbumPhotos([]);
    setAlbumPhotosHasMore(false);
    setAlbumPhotosLoading(true);
    try {
      const data = await fetchAlbumPhotos(albumId, 0, 50);
      setActiveAlbum(data.album);
      setAlbumPhotos(data.photos);
      albumPhotosOffsetRef.current = data.photos.length;
      albumPhotosHasMoreRef.current = data.hasMore;
      setAlbumPhotosHasMore(data.hasMore);
      setView("album-detail");
    } catch {
      setAlbumPhotos([]);
    } finally {
      setAlbumPhotosLoading(false);
    }
  }, []);

  const loadMoreAlbumPhotos = useCallback(async () => {
    if (albumPhotosInFlight.current || !albumPhotosHasMoreRef.current || !activeAlbum) return;
    albumPhotosInFlight.current = true;
    try {
      const data = await fetchAlbumPhotos(activeAlbum.id, albumPhotosOffsetRef.current, 50);
      setAlbumPhotos(prev => [...prev, ...data.photos]);
      albumPhotosOffsetRef.current += data.photos.length;
      albumPhotosHasMoreRef.current = data.hasMore;
      setAlbumPhotosHasMore(data.hasMore);
    } catch {}
    finally { albumPhotosInFlight.current = false; }
  }, [activeAlbum]);

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
      const activeFilterCount = filters.people.length + filters.tags.length + (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0);
      return (
        <div className="mb-4 flex flex-col gap-2">
          <form
            className="flex gap-2"
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
              type="button"
              onClick={() => setShowFilters(v => !v)}
              className={`relative px-4 py-2 text-sm font-medium rounded-full border transition-colors ${
                showFilters || activeFilterCount > 0
                  ? "bg-blue-50 border-blue-400 text-blue-700"
                  : "bg-white border-gray-300 text-gray-600 hover:border-blue-400"
              }`}
              title="Filters"
            >
              Filters
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-full transition-colors"
            >
              Search
            </button>
          </form>
          <FilterDrawer
            open={showFilters}
            options={filterOptions}
            filters={filters}
            onChange={(f) => setFilters(f)}
          />
          {/* Select mode toggle */}
          {selectMode ? (
            <div className="flex items-center gap-3 px-1">
              <span className="text-sm font-medium text-blue-700">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Tap photos to select"}
              </span>
              <button
                type="button"
                onClick={() => { setSelectedIds(new Set()); setSelectModeActive(false); }}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-1">
              <button
                type="button"
                onClick={() => setSelectModeActive(true)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ☑ Select photos
              </button>
            </div>
          )}
        </div>
      );
    }

    if (view === "people") {
      return <div className="text-xl font-semibold mb-4">People</div>;
    }

    return null;
  }, [view, activePerson, searchInput, submitSearch, showFilters, filters, filterOptions, selectMode, selectedIds]);

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
          <PhotoMasonry
            photos={photos}
            onPhotoClick={openPhoto}
            selectedIds={selectedIds}
            selectMode={selectMode}
            groupByDate
          />
          <div ref={sentinelRef} className="h-10" />
        </>
      );
    }

    if (view === "albums") {
      return (
        <>
          <AlbumsGrid
            onSelectAlbum={(id) => loadAlbum(id)}
            onCreateAlbum={() => setShowCreateAlbumModal(true)}
            refreshTrigger={albumRefreshTrigger}
          />
          <CreateAlbumModal
            isOpen={showCreateAlbumModal}
            onClose={() => setShowCreateAlbumModal(false)}
            onCreated={(album) => {
              setAlbums(prev => [album, ...prev]);
              setAlbumRefreshTrigger(t => t + 1);
              setShowCreateAlbumModal(false);
            }}
          />
        </>
      );
    }

    if (view === "album-detail" && activeAlbum) {
      return (
        <>
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              className="text-sm text-blue-600 hover:underline"
              onClick={() => { setActiveAlbum(null); setAlbumPhotos([]); setView("albums"); }}
            >
              ← Back to Albums
            </button>
            <div className="text-lg font-semibold text-gray-900">{activeAlbum.name}</div>
            <div className="w-[110px]" />
          </div>
          {albumPhotosLoading && albumPhotos.length === 0 ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : albumPhotos.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No photos in this album yet.</div>
          ) : (
            <>
              <PhotoMasonry
                photos={albumPhotos}
                onPhotoClick={openPhoto}
                selectedIds={selectedIds}
                selectMode={selectMode}
                groupByDate
              />
              {albumPhotosHasMore && (
                <button
                  onClick={loadMoreAlbumPhotos}
                  className="mx-auto mt-4 block px-6 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-full"
                >
                  Load more
                </button>
              )}
            </>
          )}
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

    if (view === "on-this-day") return <OnThisDayView />;
    if (view === "map") return (
      <MapView
        onOpenPhoto={(id, filename) => {
          setModalPhoto({ id, filename, thumbnailUrl: `${import.meta.env.VITE_API_BASE_URL ?? ""}/thumbnails/${id}`, fullUrl: `${import.meta.env.VITE_API_BASE_URL ?? ""}/photos/${id}` } as Photo);
        }}
      />
    );
    if (view === "memories") return (
      <MemoriesGrid onSelectMemory={(memory) => setSlideshowMemory(memory)} />
    );
    if (view === "documents") return <DocumentsView onPhotoClick={(p) => setModalPhoto(p)} />;
    if (view === "screenshots") return <ScreenshotsView onPhotoClick={(p) => setModalPhoto(p)} />;
    if (view === "videos") return <VideosView />;
    if (view === "places") return <PlacesView onPhotoClick={(p) => setModalPhoto(p)} />;

    // Placeholder views for future features
    const placeholders: Partial<Record<AppView, { emoji: string; title: string; desc: string }>> = {
      screenshots:     { emoji: "🖥️", title: "Screenshots",             desc: "Screenshots will appear here." },
      videos:          { emoji: "🎬", title: "Videos",                  desc: "Your video files will appear here." },
      "recently-added":{ emoji: "🕐", title: "Recently added",          desc: "Photos added in the last 30 days." },
      shared:          { emoji: "🔗", title: "Shared",                  desc: "Photos shared with or by you will appear here." },
      import:          { emoji: "➕", title: "Add photos",              desc: "Import new photos into your library." },
    };

    if (view === "trash") return <TrashView user={user} />;
    if (view === "favorites") return <FavoritesView user={user} />;
    if (view === "admin") return <AdminView />;

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
            disabled={signingIn}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {signingIn ? "Opening Google…" : "Sign In With Google"}
          </button>
        </div>
      </div>
    );
  }

  if (!approvalChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Family Photos</h1>
          <p className="mt-3 text-sm text-gray-600">Checking access…</p>
        </div>
      </div>
    );
  }

  if (!isApproved) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Family Photos</h1>
          <p className="mt-4 text-sm text-gray-700">Your request is pending approval.</p>
          <p className="mt-1 text-xs text-gray-400">{user.email}</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-6 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar
        view={view}
        isAdmin={isAdmin}
        onChangeView={(v) => {
          if (v !== "person-detail") {
            setActivePerson(null);
            setPersonPhotos([]);
          }
          if (v !== "album-detail") {
            setActiveAlbum(null);
            setAlbumPhotos([]);
          }
          if (v !== "photos") {
            setSearchInput("");
            setSearchQuery("");
            setFilters(EMPTY_FILTERS);
            setShowFilters(false);
          }
          setSelectedIds(new Set());
          setSelectModeActive(false);
          setView(v);
        }}
        albums={albums}
        selectedAlbumId={activeAlbum?.id ?? null}
        onSelectAlbum={(id) => loadAlbum(id)}
        onCreateAlbum={() => setShowCreateAlbumModal(true)}
      />

      <main ref={setMainEl} className="flex-1 p-4 overflow-y-auto">
        <BirthdayBanner />
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

      <AddToAlbumModal
        isOpen={showAddToAlbumModal}
        onClose={() => setShowAddToAlbumModal(false)}
        photoIds={Array.from(selectedIds)}
        onAdded={(_albumId, albumName) => {
          setShowAddToAlbumModal(false);
          setSelectedIds(new Set());
          setSelectModeActive(false);
          setAlbumRefreshTrigger(t => t + 1);
          setAlbums(prev => prev); // trigger re-fetch in sidebar
          alert(`Added to "${albumName}"`);
        }}
      />

      {/* Memory slideshow overlay */}
      {slideshowMemory && (
        <MemorySlideshow
          memory={slideshowMemory}
          onClose={() => setSlideshowMemory(null)}
        />
      )}

      {/* Bulk action bar — fixed to viewport bottom, shown whenever select mode is active */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        selectedIds={selectedIds}
        onAction={handleBulkAction}
        onClear={() => { setSelectedIds(new Set()); setSelectModeActive(false); }}
        isLoading={bulkLoading}
        selectModeActive={selectMode}
        onAddToAlbum={() => setShowAddToAlbumModal(true)}
      />
    </div>
  );
}
