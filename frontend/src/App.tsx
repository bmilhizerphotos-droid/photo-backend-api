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
  fetchPeopleSuggestions,
  confirmPeopleSuggestion,
  rejectPeopleSuggestion,
  mergePeople,
  Photo,
  Album,
  Person,
  SearchMeta,
  SearchFilters,
  FilterOptions,
  EMPTY_FILTERS,
  hasActiveFilters,
  PeopleSuggestion,
  PeopleSuggestionMatch,
} from "./api";
import { useInfinitePhotos } from "./hooks/useInfinitePhotos";
import { useIntersectionSentinel } from "./hooks/useIntersectionSentinel";

import { PhotoMasonry } from "./components/PhotoMasonry";
import { PeopleGrid } from "./components/PeopleGrid";
import Sidebar, { AppView, VIEW_PATHS } from "./components/Sidebar";
import { useNavigate, useLocation } from "react-router-dom";
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
import PhotoEditor from "./components/PhotoEditor";
import { MergeSuggestionBar } from "./components/MergeSuggestionBar";
import { MergeReviewModal } from "./components/MergeReviewModal";
import { MergePeopleModal } from "./components/MergePeopleModal";
import { FaceExpandModal } from "./components/FaceExpandModal";
import { useAuth } from "./hooks/useAuth";
import { Memory } from "./api";
import SearchView from "./components/SearchView";

const ADMIN_EMAIL = "bmilhizerphotos@gmail.com";

function pathToView(pathname: string): AppView {
  if (pathname.startsWith("/people/unidentified")) return "unidentified";
  if (pathname.startsWith("/people/")) return "people";
  if (pathname.startsWith("/albums/")) return "albums";
  const map: Record<string, AppView> = {
    "/photos": "photos",
    "/search": "search",
    "/on-this-day": "on-this-day",
    "/memories": "memories",
    "/albums": "albums",
    "/documents": "documents",
    "/screenshots": "screenshots",
    "/favorites": "favorites",
    "/people": "people",
    "/map": "map",
    "/places": "places",
    "/videos": "videos",
    "/recently-added": "recently-added",
    "/shared": "shared",
    "/import": "import",
    "/trash": "trash",
    "/duplicates": "duplicates",
    "/admin": "admin",
  };
  return map[pathname] ?? "photos";
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading, signingIn, error: authError, signIn, signOut } = useAuth();
  const [view, setView] = useState<AppView>(() => pathToView(window.location.pathname));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });
  const [isApproved, setIsApproved] = useState<boolean | null>(null); // null=checking, false=denied, true=approved
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

  // Face suggestions & merge state
  const [suggestions, setSuggestions] = useState<PeopleSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [dismissedPersonIds, setDismissedPersonIds] = useState<Set<number>>(new Set());
  const [reviewSuggestion, setReviewSuggestion] = useState<PeopleSuggestion | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [expandFace, setExpandFace] = useState<{ match: PeopleSuggestionMatch; personName: string } | null>(null);

  const [modalPhoto, setModalPhoto] = useState<Photo | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);

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
    updatePhoto,
  } = useInfinitePhotos(fetchPhotos, 50);

  // Submit search (called by form onSubmit and search button)
  const submitSearch = useCallback(() => {
    const q = searchInput.trim();
    setSearchQuery(q);
    if (q) {
      setView("search");
      navigate(`/search?q=${encodeURIComponent(q)}`);
    }
  }, [searchInput, navigate]);

  // Remove a single term from the search query (used by chip × buttons)
  const removeTerm = useCallback((term: string) => {
    const updated = searchInput
      .split(/\s+/)
      .filter(w => w.toLowerCase() !== term.toLowerCase())
      .join(" ")
      .trim();
    setSearchInput(updated);
    setSearchQuery(updated);
  }, [searchInput]);

  // Sync view state when browser back/forward changes the URL
  useEffect(() => {
    const v = pathToView(location.pathname);
    setView(v);
    if (v === "search") {
      const params = new URLSearchParams(location.search);
      const q = params.get("q") ?? "";
      setSearchInput(q);
      setSearchQuery(q);
    }
  }, [location.pathname, location.search]);

  const searching = (view === "search") || (view === "photos" && hasActiveFilters(filters));

  const sentinelRef = useIntersectionSentinel({
    enabled: !!user && isApproved === true && view === "photos" && !searching && hasMore && !photosLoading,
    onIntersect: loadMore,
    root: mainEl,
  });

  // Load albums (sidebar) on mount — only once approved
  useEffect(() => {
    if (!user || !isApproved) {
      setAlbums([]);
      return;
    }
    fetchAlbums().then(setAlbums).catch(() => setAlbums([]));
  }, [user, isApproved]);

  // Load filter options (people + tags) once when user authenticates — only once approved
  useEffect(() => {
    if (!user || !isApproved) { setFilterOptions({ people: [], tags: [] }); return; }
    fetchFilterOptions().then(setFilterOptions).catch(() => {});
  }, [user, isApproved]);

  // Load "People" when view is people, then load suggestions
  useEffect(() => {
    if (view !== "people") return;

    let cancelled = false;
    setPeopleLoading(true);
    setSuggestions([]);
    setSuggestionsLoading(true);
    setDismissedPersonIds(new Set());

    fetchPeople()
      .then((data) => {
        if (cancelled) return;
        setPeople(Array.isArray(data) ? data : []);
      })
      .catch(() => { if (!cancelled) setPeople([]); })
      .finally(() => { if (!cancelled) setPeopleLoading(false); });

    fetchPeopleSuggestions()
      .then((data) => { if (!cancelled) setSuggestions(data); })
      .catch(() => { if (!cancelled) setSuggestions([]); })
      .finally(() => { if (!cancelled) setSuggestionsLoading(false); });

    return () => { cancelled = true; };
  }, [view]);

  const handleConfirmSuggestion = useCallback(async (suggestion: PeopleSuggestion) => {
    const photoIds = suggestion.matches.map((m) => m.photoId);
    await confirmPeopleSuggestion(suggestion.person.id, photoIds);
    setSuggestions((prev) => prev.filter((s) => s.person.id !== suggestion.person.id));
    setPeople((prev) =>
      prev.map((p) =>
        p.id === suggestion.person.id
          ? { ...p, photoCount: p.photoCount + photoIds.length }
          : p
      )
    );
  }, []);

  const handleRejectSuggestion = useCallback(async (suggestion: PeopleSuggestion) => {
    const faceIds = suggestion.matches.map((m) => m.faceId);
    await rejectPeopleSuggestion(suggestion.person.id, faceIds);
    setSuggestions((prev) => prev.filter((s) => s.person.id !== suggestion.person.id));
  }, []);

  const handleConfirmSelectedSuggestion = useCallback(async (personId: number, photoIds: number[]) => {
    await confirmPeopleSuggestion(personId, photoIds);
    setSuggestions((prev) =>
      prev.map((s) =>
        s.person.id !== personId
          ? s
          : {
              ...s,
              matches: s.matches.filter((m) => !photoIds.includes(m.photoId)),
              totalCount: s.totalCount - photoIds.length,
            }
      ).filter((s) => s.totalCount > 0)
    );
    setPeople((prev) =>
      prev.map((p) =>
        p.id === personId ? { ...p, photoCount: p.photoCount + photoIds.length } : p
      )
    );
    setReviewSuggestion(null);
  }, []);

  const handleMergePeople = useCallback(async (sourceId: number, targetId: number) => {
    await mergePeople(sourceId, targetId);
    // Reload people list
    const data = await fetchPeople();
    setPeople(Array.isArray(data) ? data : []);
    setShowMergeModal(false);
  }, []);

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
      setIsAdmin(false);
      return;
    }
    setIsApproved(null); // reset to "checking" on every user change
    fetchMe()
      .then((data) => {
        setIsApproved(data.isApproved === true);
        setIsAdmin(data.isAdmin === true);
      })
      .catch((err) => {
        console.error("fetchMe failed:", err);
        const adminFallback = (user.email ?? '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
        setIsApproved(adminFallback);
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

    if (isApproved === true) {
      resetPhotos();
      loadMore();
    }
  }, [user, isApproved, resetPhotos, loadMore]);

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
      navigate(`/albums/${albumId}`);
    } catch {
      setAlbumPhotos([]);
    } finally {
      setAlbumPhotosLoading(false);
    }
  }, [navigate]);

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
    navigate(`/people/${person.id}`);

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
  }, [navigate]);

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
              navigate(-1);
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

    if (view === "photos" || view === "search") {
      const activeFilterCount = filters.people.length + filters.tags.length + (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0);
      return (
        <div className="mb-4 flex flex-col gap-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); submitSearch(); }}
          >
            <input
              id="photo-search"
              name="photo-search"
              type="text"
              placeholder='Search photos…'
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              autoComplete="off"
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-full text-sm bg-gray-100 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
            />
            {searchInput.trim() && (
              <button
                type="button"
                onClick={() => { setSearchInput(""); setSearchQuery(""); setView("photos"); navigate("/photos"); }}
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
      return (
        <div className="flex items-center justify-between mb-4">
          <div className="text-xl font-semibold">People</div>
          <button
            onClick={() => setShowMergeModal(true)}
            className="px-3 py-1.5 text-xs rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Merge Duplicates
          </button>
        </div>
      );
    }

    return null;
  }, [view, activePerson, searchInput, submitSearch, showFilters, filters, filterOptions, selectMode, selectedIds, setShowMergeModal, navigate]);

  const renderView = () => {
    if (view === "search") {
      return (
        <SearchView
          query={searchQuery}
          meta={searchMeta}
          results={searchResults}
          loading={searchLoading}
          loadingMore={searchLoadingMore}
          hasMore={searchHasMore}
          sentinelRef={searchSentinelRef}
          onPhotoClick={(p) => openPhoto(p)}
          onRemoveTerm={removeTerm}
        />
      );
    }

    if (view === "photos") {
      if (searching) {
        return (
          <SearchView
            query={searchQuery}
            meta={searchMeta}
            results={searchResults}
            loading={searchLoading}
            loadingMore={searchLoadingMore}
            hasMore={searchHasMore}
            sentinelRef={searchSentinelRef}
            onPhotoClick={(p) => openPhoto(p)}
            onRemoveTerm={removeTerm}
          />
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
              onClick={() => { setActiveAlbum(null); setAlbumPhotos([]); navigate(-1); }}
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
      const visibleSuggestions = suggestions.filter((s) => !dismissedPersonIds.has(s.person.id));
      return (
        <>
          <MergeSuggestionBar
            suggestions={visibleSuggestions}
            loading={suggestionsLoading}
            onConfirmAll={handleConfirmSuggestion}
            onReview={(s) => setReviewSuggestion(s)}
            onRejectAll={handleRejectSuggestion}
            onExpand={(match, personName) => setExpandFace({ match, personName })}
          />
          <PeopleGrid
            people={people}
            onPersonClick={loadPerson}
            onUnidentifiedClick={() => { setView("unidentified"); navigate("/people/unidentified"); }}
            loading={peopleLoading}
          />
        </>
      );
    }

    if (view === "unidentified") {
      return (
        <UnidentifiedFaces
          onBack={() => navigate(-1)}
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

  // 1. Not logged in
  if (!authLoading && !user) {
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

  // 2. Firebase auth loading OR approval check in flight
  if (authLoading || isApproved === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Family Photos</h1>
          <div className="mt-4 flex justify-center">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  // 3. Checked and denied
  if (isApproved === false) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Family Photos</h1>
          <p className="mt-4 text-sm text-gray-700">Your account is pending approval by the administrator.</p>
          <p className="mt-1 text-xs text-gray-400">{user?.email}</p>
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

  // 4. isApproved === true — fall through to full app

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar
        view={view}
        isAdmin={isAdmin}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => {
          const next = !prev;
          try { localStorage.setItem("sidebar-collapsed", String(next)); } catch {}
          return next;
        })}
        onChangeView={(v) => {
          if (v !== "person-detail") {
            setActivePerson(null);
            setPersonPhotos([]);
          }
          if (v !== "album-detail") {
            setActiveAlbum(null);
            setAlbumPhotos([]);
          }
          if (v !== "photos" && v !== "search") {
            setSearchInput("");
            setSearchQuery("");
            setFilters(EMPTY_FILTERS);
            setShowFilters(false);
          }
          setSelectedIds(new Set());
          setSelectModeActive(false);
          setView(v);
          navigate(VIEW_PATHS[v] ?? "/photos");
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
          onEdit={(p) => { setEditingPhoto(p); setModalPhoto(null); }}
        />
      {editingPhoto && (
        <PhotoEditor
          photo={editingPhoto}
          onClose={() => setEditingPhoto(null)}
          onSaved={() => {
            const ts = Date.now();
            // Bust cache-buster on modal image URL (preserving auth token)
            const base = editingPhoto.image_url ?? '';
            const sep  = base.includes('?') ? '&' : '?';
            setModalPhoto({ ...editingPhoto, image_url: base + `${sep}t=${ts}` });
            // Also bust the thumbnail in the photo grid
            const thumb = (editingPhoto as any).thumbnailUrl ?? '';
            const tsep  = thumb.includes('?') ? '&' : '?';
            updatePhoto(editingPhoto.id, { thumbnailUrl: thumb + `${tsep}t=${ts}` });
            setEditingPhoto(null);
          }}
        />
      )}
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

      {/* Face merge review modal */}
      {reviewSuggestion && (
        <MergeReviewModal
          suggestion={reviewSuggestion}
          onConfirm={(photoIds) => handleConfirmSelectedSuggestion(reviewSuggestion.person.id, photoIds)}
          onCancel={() => setReviewSuggestion(null)}
        />
      )}

      {/* Merge people modal */}
      {showMergeModal && (
        <MergePeopleModal
          people={people}
          onMerge={handleMergePeople}
          onCancel={() => setShowMergeModal(false)}
        />
      )}

      {/* Face expand modal (click thumbnail → full photo + bbox) */}
      {expandFace && (
        <FaceExpandModal
          imageUrl={expandFace.match.thumbnailUrl.replace(/\/thumbnails\/(\d+)/, "/api/photos/$1/file")}
          faceBbox={expandFace.match.faceBbox}
          personName={expandFace.personName}
          onClose={() => setExpandFace(null)}
        />
      )}

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
