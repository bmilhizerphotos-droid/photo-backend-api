// frontend/src/api.ts

import { auth } from './firebase';

// IMPORTANT:
// - In dev: use relative /api (Vite proxy → no CORS)
// - In prod: VITE_API_BASE_URL is injected at build time
const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";

/* =====================
   HELPERS
   ===================== */

export async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) {
    console.warn("⚠️ getAuthToken: No authenticated user. Proceeding without token.");
    return null;
  }
  return await user.getIdToken();
}

async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Auto-set JSON content type when body is a serialised string
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const signal = options.signal ?? AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...options, headers, signal });
}

function withApiBase(url: string | null | undefined): string | null {
  if (!url) return null;

  // Already absolute (http/https)
  if (/^https?:\/\//i.test(url)) return url;

  // If it starts with "/", treat as relative to API_BASE (in prod)
  if (API_BASE && url.startsWith("/")) return `${API_BASE}${url}`;

  // Otherwise, leave as-is (dev proxy or already-relative behavior)
  return url;
}

function appendToken(url: string | null | undefined, token: string | null): string | null {
  const fullUrl = withApiBase(url);
  if (!fullUrl) return null;
  if (!token) return fullUrl;
  return fullUrl + (fullUrl.includes('?') ? '&' : '?') + `token=${token}`;
}

function normalizePhoto(p: any, token: string | null): Photo {
  const rawThumbnailUrl =
    p.thumbnail_url ??
    p.thumbnailUrl ??
    (typeof p.id === "number" ? `/thumbnails/${p.id}` : null);
  const rawImageUrl =
    p.image_url ??
    p.imageUrl ??
    p.fullUrl ??
    (typeof p.id === "number" ? `/display/${p.id}` : null);

  return {
    ...p,
    thumbnail_url: appendToken(rawThumbnailUrl, token) ?? "",
    image_url: appendToken(rawImageUrl, token) ?? "",
    thumbnailUrl: appendToken(rawThumbnailUrl, token) ?? "",
    fullUrl: appendToken(rawImageUrl, token) ?? ""
  };
}

function normalizePhotos(list: any[], token: string | null): Photo[] {
  return (Array.isArray(list) ? list : []).map(p => normalizePhoto(p, token));
}

/* =====================
   TYPES
   ===================== */

export interface Photo {
  id: number;
  filename: string;
  thumbnail_url: string;
  image_url: string;
  [key: string]: any;
}

// Keep this permissive because your backend returns a simpler shape
export interface Album {
  id: number;
  name: string;
  description?: string | null;
  coverPhotoId?: number | null;
  coverPhotoUrl?: string | null;
  photoCount?: number | null;
  createdAt?: string;
  updatedAt?: string;
  thumbnail_url?: string | null;
  photo_count?: number | null;
}

export interface Person {
  id: number;
  name: string;
  photoCount: number;
  thumbnailUrl: string | null;
}

export interface Face {
  id: number;
  personId: number | null;
  personName: string | null;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
}

export interface PhotoWithFaces extends Photo {
  unidentifiedCount: number;
}

export interface DuplicatePhoto {
  id: number;
  filename: string;
  dateTaken: string | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string;
  fullUrl: string;
  isDeleted: boolean;
}

export interface DuplicateGroup {
  groupId: number;
  count: number;
  photos: DuplicatePhoto[];
}

export interface DuplicateStats {
  totalPhotos: number;
  hashedPhotos: number;
  duplicateGroups: number;
  duplicatePhotos: number;
  burstGroups: number;
  burstPhotos: number;
  scanning: boolean;
}

/* =====================
   PHOTOS
   ===================== */

export async function fetchPhotos(offset = 0, limit = 50): Promise<Photo[]> {
  const url = API_BASE
    ? `${API_BASE}/api/photos?offset=${offset}&limit=${limit}`
    : `/api/photos?offset=${offset}&limit=${limit}`;

  const res = await fetchWithAuth(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch photos: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const photos = data?.photos ?? data;
  const token = await getAuthToken();
  return normalizePhotos(photos, token);
}

/* =====================
   ALBUMS
   ===================== */

export async function fetchAlbums(): Promise<Album[]> {
  const url = API_BASE ? `${API_BASE}/api/albums` : `/api/albums`;
  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch albums: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    // Support both shapes:
    // - { albums: [...] }  (your backend)
    // - [...]             (older frontend expectations)
    const albums = Array.isArray(data) ? data : data?.albums;
    const token = await getAuthToken();
    return (Array.isArray(albums) ? albums : []).map(a => ({
      ...a,
      thumbnail_url: appendToken(a.thumbnail_url, token),
      coverPhotoUrl: appendToken(a.coverPhotoUrl, token)
    }));
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error("Timeout fetching albums");
      throw new Error("Request timeout - please check your internet connection");
    } else {
      console.error("Error fetching albums:", error);
    }
    return [];
  }
}

export async function createAlbum(name: string, description?: string): Promise<Album> {
  const url = API_BASE ? `${API_BASE}/api/albums` : `/api/albums`;
  const res = await fetchWithAuth(url, { method: "POST", body: JSON.stringify({ name, description }) });
  if (!res.ok) throw new Error(`Failed to create album: ${res.status}`);
  return res.json();
}

export async function updateAlbum(id: number, updates: { name: string; description?: string }): Promise<void> {
  const url = API_BASE ? `${API_BASE}/api/albums/${id}` : `/api/albums/${id}`;
  const res = await fetchWithAuth(url, { method: "PUT", body: JSON.stringify(updates) });
  if (!res.ok) throw new Error(`Failed to update album: ${res.status}`);
}

export async function deleteAlbum(id: number): Promise<void> {
  const url = API_BASE ? `${API_BASE}/api/albums/${id}` : `/api/albums/${id}`;
  const res = await fetchWithAuth(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete album: ${res.status}`);
}

export async function fetchAlbumPhotos(albumId: number, offset = 0, limit = 50): Promise<{
  album: { id: number; name: string; description?: string | null };
  photos: Photo[];
  total: number;
  hasMore: boolean;
}> {
  const url = API_BASE
    ? `${API_BASE}/api/albums/${albumId}/photos?offset=${offset}&limit=${limit}`
    : `/api/albums/${albumId}/photos?offset=${offset}&limit=${limit}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch album photos: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  return {
    album: data.album,
    total: data.total ?? 0,
    hasMore: data.hasMore ?? false,
    photos: normalizePhotos(data.photos ?? [], token),
  };
}

export async function addPhotosToAlbum(albumId: number, photoIds: number[]): Promise<void> {
  const url = API_BASE ? `${API_BASE}/api/albums/${albumId}/photos` : `/api/albums/${albumId}/photos`;
  const res = await fetchWithAuth(url, { method: "POST", body: JSON.stringify({ photoIds }) });
  if (!res.ok) throw new Error(`Failed to add photos to album: ${res.status}`);
}

export async function removePhotosFromAlbum(albumId: number, photoIds: number[]): Promise<void> {
  const url = API_BASE ? `${API_BASE}/api/albums/${albumId}/photos` : `/api/albums/${albumId}/photos`;
  const res = await fetchWithAuth(url, { method: "DELETE", body: JSON.stringify({ photoIds }) });
  if (!res.ok) throw new Error(`Failed to remove photos from album: ${res.status}`);
}

/* =====================
   PEOPLE
   ===================== */

export async function fetchPeople(): Promise<Person[]> {
  const url = API_BASE ? `${API_BASE}/api/people` : `/api/people`;
  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch people: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const token = await getAuthToken();
    return (Array.isArray(data) ? data : []).map((p: any) => ({
      ...p,
      thumbnailUrl: appendToken(p.thumbnailUrl, token)
    }));
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error("Timeout fetching people");
      throw new Error("Request timeout - please check your internet connection");
    } else {
      console.error("Error fetching people:", error);
    }
    return [];
  }
}

export async function searchPeople(query: string): Promise<Person[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return fetchPeople();
  }

  const people = await fetchPeople();
  return people.filter((person) => person.name.toLowerCase().includes(normalized));
}

export async function fetchPersonPhotos(personId: number): Promise<Photo[]> {
  const url = API_BASE
    ? `${API_BASE}/api/people/${personId}/photos`
    : `/api/people/${personId}/photos`;

  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch person photos: ${res.status} ${res.statusText}`
      );
    }
    const data = await res.json();

    // Support both:
    // - { photos: [...] }
    // - [...]
    const photos = Array.isArray(data) ? data : data?.photos;
    const token = await getAuthToken();
    return normalizePhotos(photos, token);
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error("Timeout fetching person photos");
      throw new Error("Request timeout - please check your internet connection");
    } else {
      console.error("Error fetching person photos:", error);
    }
    return [];
  }
}

/* =====================
   SEARCH
   ===================== */

export interface SearchMeta {
  personName: string | null;
  dateRange: { start: string; end: string } | null;
  concepts: string[];
  sources: { person: number; date: number; fts: number; tags: number; semantic: number };
}

export interface SearchResult {
  photos: Photo[];
  count: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  mode: string;
  meta: SearchMeta;
}

export async function searchPhotos(query: string, offset = 0, limit = 50): Promise<SearchResult> {
  const url = API_BASE
    ? `${API_BASE}/api/search?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`
    : `/api/search?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`;

  try {
    const res = await fetchWithAuth(url, {}, 15000);
    if (!res.ok) {
      throw new Error(`Search failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const photos = Array.isArray(data?.photos) ? data.photos : [];
    const token = await getAuthToken();
    return {
      photos: normalizePhotos(photos, token),
      count: data?.count ?? photos.length,
      offset: data?.offset ?? offset,
      limit: data?.limit ?? limit,
      hasMore: data?.hasMore ?? false,
      mode: data?.mode ?? 'unknown',
      meta: data?.meta ?? { personName: null, dateRange: null, concepts: [], sources: { person: 0, date: 0, fts: 0, tags: 0, semantic: 0 } }
    };
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error("Search timed out — please try again");
    }
    console.error("Error searching photos:", error);
    return { photos: [], count: 0, offset, limit, hasMore: false, mode: 'error', meta: { personName: null, dateRange: null, concepts: [], sources: { person: 0, date: 0, fts: 0, tags: 0, semantic: 0 } } };
  }
}

export async function fetchUnidentifiedCount(): Promise<{
  photoCount: number;
  faceCount: number;
}> {
  const url = API_BASE
    ? `${API_BASE}/api/people/unidentified`
    : `/api/people/unidentified`;

  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch unidentified count: ${res.status} ${res.statusText}`
      );
    }
    return res.json();
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error("Timeout fetching unidentified count");
      throw new Error("Request timeout - please check your internet connection");
    } else {
      console.error("Error fetching unidentified count:", error);
    }
    return { photoCount: 0, faceCount: 0 };
  }
}

export async function fetchPhotoFaces(photoId: number): Promise<Face[]> {
  void photoId;
  return [];
}

export async function fetchPhotoTaggedPeople(photoId: number): Promise<Person[]> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/${photoId}/people`
    : `/api/photos/${photoId}/people`;

  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch tagged people: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const token = await getAuthToken();
    return (Array.isArray(data) ? data : []).map((p: any) => ({
      ...p,
      thumbnailUrl: appendToken(p.thumbnailUrl, token)
    }));
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error("Request timeout - please check your internet connection");
    }
    console.error("Error fetching tagged people:", error);
    return [];
  }
}

export async function bulkTagPhotos(photoIds: number[], personId: number): Promise<void> {
  const url = API_BASE ? `${API_BASE}/api/photos/bulk` : `/api/photos/bulk`;
  const res = await fetchWithAuth(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "tag_person", photoIds, personId }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Bulk tag failed: ${res.status}`);
  }
}

export async function tagPersonInPhoto(photoId: number, personId: number): Promise<void> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/${photoId}/people`
    : `/api/photos/${photoId}/people`;

  const res = await fetchWithAuth(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ personId }),
  });

  if (!res.ok) {
    throw new Error(`Failed to tag person in photo: ${res.status} ${res.statusText}`);
  }
}

export async function removePersonTagFromPhoto(photoId: number, personId: number): Promise<void> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/${photoId}/people/${personId}`
    : `/api/photos/${photoId}/people/${personId}`;

  const res = await fetchWithAuth(url, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error(`Failed to remove person tag: ${res.status} ${res.statusText}`);
  }
}

export async function identifyFace(_faceId: number, _personId: number): Promise<void> {
  throw new Error("Face identification is not available in this build yet.");
}

export async function createPersonFromFace(_faceId: number, _name: string): Promise<{ person: Person }> {
  throw new Error("Creating a person from a face is not available in this build yet.");
}

export async function fetchUnidentifiedPhotos(_offset = 0, _limit = 50): Promise<{
  photos: PhotoWithFaces[];
  total: number;
}> {
  const offset = Number(_offset || 0);
  const limit = Number(_limit || 50);
  const url = API_BASE
    ? `${API_BASE}/api/people/unidentified/photos?offset=${offset}&limit=${limit}`
    : `/api/people/unidentified/photos?offset=${offset}&limit=${limit}`;

  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch unidentified photos: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const token = await getAuthToken();
    return {
      total: Number(data?.total || 0),
      photos: (Array.isArray(data?.photos) ? data.photos : []).map((photo: any) => ({
        ...normalizePhoto(photo, token),
        unidentifiedCount: Number(photo.unidentifiedCount || 0),
      })),
    };
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error("Request timeout - please check your internet connection");
    }
    console.error("Error fetching unidentified photos:", error);
    return { photos: [], total: 0 };
  }
}

export async function fetchDuplicateStats(): Promise<DuplicateStats> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/duplicates/stats`
    : `/api/photos/duplicates/stats`;

  const res = await fetchWithAuth(url, {}, 60000);

  if (!res.ok) {
    throw new Error(`Failed to fetch duplicate stats: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function fetchDuplicateGroups(
  pathname: string,
  offset = 0,
  limit = 25
): Promise<{ groups: DuplicateGroup[]; hasMore: boolean }> {
  const sep = pathname.includes("?") ? "&" : "?";
  const full = `${pathname}${sep}offset=${offset}&limit=${limit}`;
  const url = API_BASE ? `${API_BASE}${full}` : full;
  const res = await fetchWithAuth(url, {}, 60000);

  if (!res.ok) {
    throw new Error(`Failed to fetch duplicate groups: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const token = await getAuthToken();
  const raw = Array.isArray(data) ? data : (data?.groups ?? []);
  const hasMore: boolean = data?.hasMore ?? false;

  const groups = raw.map((group: any) => ({
    groupId: Number(group.groupId),
    count: Number(group.count || 0),
    photos: (Array.isArray(group.photos) ? group.photos : []).map((photo: any) => ({
      id: Number(photo.id),
      filename: String(photo.filename || ""),
      dateTaken: photo.dateTaken ?? null,
      width: photo.width ?? null,
      height: photo.height ?? null,
      thumbnailUrl: appendToken(photo.thumbnailUrl, token) ?? "",
      fullUrl: appendToken(photo.fullUrl, token) ?? "",
      isDeleted: Boolean(photo.isDeleted),
    })),
  }));

  return { groups, hasMore };
}

export async function fetchDuplicates(
  offset = 0,
  limit = 25
): Promise<{ groups: DuplicateGroup[]; hasMore: boolean }> {
  return fetchDuplicateGroups("/api/photos/duplicates", offset, limit);
}

export async function fetchBursts(
  offset = 0,
  limit = 25
): Promise<{ groups: DuplicateGroup[]; hasMore: boolean }> {
  return fetchDuplicateGroups("/api/photos/bursts", offset, limit);
}

export async function keepBestDuplicates(): Promise<{ deleted: number; total: number }> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/duplicates/keep-best`
    : `/api/photos/duplicates/keep-best`;

  const res = await fetchWithAuth(url, { method: "POST" }, 120000);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to keep best: ${res.status}`);
  }

  return res.json();
}

export async function startDuplicateScan(): Promise<{ started: boolean; message: string }> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/scan-duplicates`
    : `/api/photos/scan-duplicates`;

  const res = await fetchWithAuth(url, {
    method: "POST",
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to start duplicate scan: ${res.status}`);
  }

  return res.json();
}

// ── Documents ──────────────────────────────────────────────────────────────

export interface DocumentScanStatus {
  running: boolean;
  total: number;
  scanned: number;
  documents: number;
}

export async function fetchDocuments(
  offset = 0,
  limit = 50
): Promise<{ photos: Photo[]; total: number; hasMore: boolean; scanned: number }> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/documents?offset=${offset}&limit=${limit}`
    : `/api/photos/documents?offset=${offset}&limit=${limit}`;

  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch documents: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  const photos = normalizePhotos(data.photos ?? [], token);
  return { photos, total: data.total ?? 0, hasMore: data.hasMore ?? false, scanned: data.scanned ?? 0 };
}

export async function startDocumentScan(): Promise<{ started: boolean; message: string }> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/scan-documents`
    : `/api/photos/scan-documents`;
  const res = await fetchWithAuth(url, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start document scan: ${res.status}`);
  return res.json();
}

export async function fetchDocumentScanStatus(): Promise<DocumentScanStatus> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/documents/status`
    : `/api/photos/documents/status`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to get document scan status: ${res.status}`);
  return res.json();
}

// ── Screenshots ────────────────────────────────────────────────────────────

export async function fetchScreenshots(
  offset = 0,
  limit = 50
): Promise<{ photos: Photo[]; total: number; hasMore: boolean; scanned: number }> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/screenshots?offset=${offset}&limit=${limit}`
    : `/api/photos/screenshots?offset=${offset}&limit=${limit}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch screenshots: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  return {
    photos: normalizePhotos(data.photos ?? [], token),
    total: data.total ?? 0,
    hasMore: data.hasMore ?? false,
    scanned: data.scanned ?? 0,
  };
}

export async function startScreenshotScan(): Promise<{ started: boolean; message: string }> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/scan-screenshots`
    : `/api/photos/scan-screenshots`;
  const res = await fetchWithAuth(url, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start screenshot scan: ${res.status}`);
  return res.json();
}

export async function fetchScreenshotScanStatus(): Promise<{
  running: boolean; total: number; scanned: number; screenshots: number;
}> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/screenshots/status`
    : `/api/photos/screenshots/status`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to get screenshot scan status: ${res.status}`);
  return res.json();
}

// ── Videos ────────────────────────────────────────
export interface VideoItem {
  id: number;
  filename: string;
  dateTaken: string | null;
  duration: number | null;
  thumbnailUrl: string;
  streamUrl: string;
}

export async function fetchVideos(offset = 0, limit = 50): Promise<{ videos: VideoItem[]; total: number; hasMore: boolean }> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/videos?offset=${offset}&limit=${limit}`
    : `/api/photos/videos?offset=${offset}&limit=${limit}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch videos: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  const videos: VideoItem[] = (data.videos ?? []).map((v: any) => ({
    id: v.id,
    filename: v.filename,
    dateTaken: v.dateTaken,
    duration: v.duration,
    thumbnailUrl: appendToken(v.thumbnailUrl, token) ?? v.thumbnailUrl,
    streamUrl: appendToken(v.streamUrl, token) ?? v.streamUrl,
  }));
  return { videos, total: data.total ?? 0, hasMore: data.hasMore ?? false };
}

export async function startVideoScan(): Promise<{ started: boolean }> {
  const url = API_BASE ? `${API_BASE}/api/photos/scan-videos` : `/api/photos/scan-videos`;
  const res = await fetchWithAuth(url, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start video scan: ${res.status}`);
  return res.json();
}

export async function fetchVideoScanStatus(): Promise<{ running: boolean; found: number; error: string | null }> {
  const url = API_BASE ? `${API_BASE}/api/photos/videos/status` : `/api/photos/videos/status`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to get video scan status: ${res.status}`);
  return res.json();
}

export async function softDeletePhotos(photoIds: number[]): Promise<void> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/soft-delete`
    : `/api/photos/soft-delete`;

    const res = await fetchWithAuth(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ photoIds }),
    });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to soft-delete photos: ${res.status}`);
  }
}

export async function restorePhotos(photoIds: number[]): Promise<void> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/restore`
    : `/api/photos/restore`;

    const res = await fetchWithAuth(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ photoIds }),
    });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to restore photos: ${res.status}`);
  }
}

export interface TrashPhoto {
  id: number;
  filename: string;
  thumbnailUrl: string;
  dateTaken: string | null;
  createdAt: string;
}

export async function fetchTrash(offset = 0, limit = 50): Promise<{
  photos: TrashPhoto[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/trash?offset=${offset}&limit=${limit}`
    : `/api/photos/trash?offset=${offset}&limit=${limit}`;

  const res = await fetchWithAuth(url, {}, 30000);
  if (!res.ok) throw new Error(`Failed to fetch trash: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  const photos: TrashPhoto[] = (data.photos ?? []).map((p: TrashPhoto) => ({
    ...p,
    thumbnailUrl: appendToken(p.thumbnailUrl, token) ?? p.thumbnailUrl,
  }));
  return { ...data, photos };
}

export interface FavoritePhoto {
  id: number;
  filename: string;
  thumbnailUrl: string;
  dateTaken: string | null;
  createdAt: string;
  isFavorite: true;
}

export async function fetchFavorites(offset = 0, limit = 50): Promise<{
  photos: FavoritePhoto[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/favorites?offset=${offset}&limit=${limit}`
    : `/api/photos/favorites?offset=${offset}&limit=${limit}`;

  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch favorites: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  const photos: FavoritePhoto[] = (data.photos ?? []).map((p: FavoritePhoto) => ({
    ...p,
    thumbnailUrl: appendToken(p.thumbnailUrl, token) ?? p.thumbnailUrl,
  }));
  return { ...data, photos };
}

export async function bulkAction(
  action: 'favorite' | 'unfavorite' | 'delete',
  photoIds: number[]
): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const url = API_BASE ? `${API_BASE}/api/photos/bulk` : `/api/photos/bulk`;
  const res = await fetchWithAuth(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, photoIds }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Bulk action failed: ${res.status}`);
  }
  return res.json();
}

export async function permanentlyDeletePhotos(photoIds: number[]): Promise<{ deleted: number }> {
  const url = API_BASE
    ? `${API_BASE}/api/photos/trash`
    : `/api/photos/trash`;

  const res = await fetchWithAuth(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoIds }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to permanently delete: ${res.status}`);
  }
  return res.json();
}

// ── Empty Trash ─────────────────────────────────
export async function emptyTrash(): Promise<{ deleted: number }> {
  const url = API_BASE ? `${API_BASE}/api/photos/trash/empty` : `/api/photos/trash/empty`;
  const res = await fetchWithAuth(url, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to empty trash: ${res.status}`);
  return res.json();
}

// ── On This Day ─────────────────────────────────
export interface OnThisDayGroup {
  year: number;
  photos: { id: number; filename: string; thumbnailUrl: string; dateTaken: string }[];
}

// ── Map View ──────────────────────────────────────
export interface MapPhoto {
  id: number;
  filename: string;
  dateTaken: string | null;
  lat: number;
  lng: number;
}

export async function fetchMapPhotos(): Promise<MapPhoto[]> {
  const url = API_BASE ? `${API_BASE}/api/photos/map` : `/api/photos/map`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch map photos: ${res.status}`);
  const data = await res.json();
  return data.photos ?? [];
}

export async function fetchOnThisDay(): Promise<{ groups: OnThisDayGroup[]; total: number }> {
  const url = API_BASE ? `${API_BASE}/api/on-this-day` : `/api/on-this-day`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch On This Day: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  const groups: OnThisDayGroup[] = (data.groups ?? []).map((g: any) => ({
    year: g.year,
    photos: (g.photos ?? []).map((p: any) => ({
      ...p,
      thumbnailUrl: appendToken(withApiBase(p.thumbnailUrl), token) ?? p.thumbnailUrl,
    })),
  }));
  return { groups, total: data.total ?? 0 };
}

// ── Birthdays ───────────────────────────────────
export interface Birthday {
  personId: number;
  name: string;
  birthday: string;
  age: number | null;
  thumbnailUrl: string | null;
  daysUntil?: number;
}

export async function fetchBirthdaysToday(): Promise<{ birthdays: Birthday[] }> {
  const url = API_BASE ? `${API_BASE}/api/birthdays/today` : `/api/birthdays/today`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch birthdays: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  return {
    birthdays: (data.birthdays ?? []).map((b: Birthday) => ({
      ...b,
      thumbnailUrl: b.thumbnailUrl ? appendToken(withApiBase(b.thumbnailUrl), token) : null,
    })),
  };
}

export async function fetchUpcomingBirthdays(days = 30): Promise<{ birthdays: Birthday[] }> {
  const url = API_BASE ? `${API_BASE}/api/birthdays/upcoming?days=${days}` : `/api/birthdays/upcoming?days=${days}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch upcoming birthdays: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  return {
    birthdays: (data.birthdays ?? []).map((b: Birthday) => ({
      ...b,
      thumbnailUrl: b.thumbnailUrl ? appendToken(withApiBase(b.thumbnailUrl), token) : null,
    })),
  };
}

export async function updatePersonBirthday(personId: number, birthday: string | null): Promise<void> {
  const url = API_BASE ? `${API_BASE}/api/people/${personId}/birthday` : `/api/people/${personId}/birthday`;
  const res = await fetchWithAuth(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ birthday }),
  });
  if (!res.ok) throw new Error(`Failed to update birthday: ${res.status}`);
}

// ── Memories ────────────────────────────────────
export interface Memory {
  id: number;
  title: string | null;
  narrative: string | null;
  locationLabel: string | null;
  eventDateStart: string;
  eventDateEnd: string;
  coverPhotoId: number | null;
  coverPhotoUrl: string | null;
  photoCount: number;
  confidence: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MemoryPhoto {
  id: number;
  filename: string;
  dateTaken: string | null;
  thumbnailUrl: string;
  imageUrl: string;
}

export async function fetchMemories(): Promise<Memory[]> {
  const url = API_BASE ? `${API_BASE}/api/memories` : `/api/memories`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch memories: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  return (data.memories ?? []).map((m: Memory) => ({
    ...m,
    coverPhotoUrl: m.coverPhotoUrl ? appendToken(withApiBase(m.coverPhotoUrl), token) : null,
  }));
}

export async function searchMemories(q: string): Promise<Memory[]> {
  const url = API_BASE
    ? `${API_BASE}/api/memories/search?q=${encodeURIComponent(q)}`
    : `/api/memories/search?q=${encodeURIComponent(q)}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to search memories: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  return (data.memories ?? []).map((m: Memory) => ({
    ...m,
    coverPhotoUrl: m.coverPhotoUrl ? appendToken(withApiBase(m.coverPhotoUrl), token) : null,
  }));
}

export async function fetchMemoryPhotos(memoryId: number): Promise<MemoryPhoto[]> {
  const url = API_BASE
    ? `${API_BASE}/api/memories/${memoryId}/photos`
    : `/api/memories/${memoryId}/photos`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch memory photos: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  return (data.photos ?? []).map((p: MemoryPhoto) => ({
    ...p,
    thumbnailUrl: appendToken(withApiBase(p.thumbnailUrl), token) ?? p.thumbnailUrl,
    imageUrl: appendToken(withApiBase(p.imageUrl), token) ?? p.imageUrl,
  }));
}

export async function deleteMemory(memoryId: number): Promise<void> {
  const url = API_BASE ? `${API_BASE}/api/memories/${memoryId}` : `/api/memories/${memoryId}`;
  const res = await fetchWithAuth(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete memory: ${res.status}`);
}

export async function updateMemory(memoryId: number, updates: { title?: string; narrative?: string; locationLabel?: string }): Promise<void> {
  const url = API_BASE ? `${API_BASE}/api/memories/${memoryId}` : `/api/memories/${memoryId}`;
  const res = await fetchWithAuth(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update memory: ${res.status}`);
}

export async function regenerateMemoriesApi(): Promise<{ started: boolean; message: string }> {
  const url = API_BASE ? `${API_BASE}/api/memories/regenerate` : `/api/memories/regenerate`;
  const res = await fetchWithAuth(url, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to regenerate memories: ${res.status}`);
  return res.json();
}

export async function fetchMemory(memoryId: number): Promise<{ memory: Memory; photos: Photo[] }> {
  const url = API_BASE ? `${API_BASE}/api/memories/${memoryId}` : `/api/memories/${memoryId}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Failed to fetch memory: ${res.status}`);
  const data = await res.json();
  const token = await getAuthToken();
  const photos = (data.photos ?? []).map((p: Photo) => ({
    ...p,
    thumbnail_url: appendToken(withApiBase(p.thumbnail_url), token) ?? p.thumbnail_url,
    image_url: appendToken(withApiBase(p.image_url), token) ?? p.image_url,
  }));
  return { memory: data.memory ?? data, photos };
}

export async function generateMemoryNarrative(memoryId: number): Promise<{ title?: string; narrative?: string; locationLabel?: string }> {
  const url = API_BASE
    ? `${API_BASE}/api/memories/${memoryId}/generate`
    : `/api/memories/${memoryId}/generate`;
  const res = await fetchWithAuth(url, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to generate narrative: ${res.status}`);
  return res.json();
}

// ── Bulk Download ZIP ────────────────────────────
export async function downloadPhotosAsZip(photoIds: number[]): Promise<void> {
  const url = API_BASE ? `${API_BASE}/api/photos/download-zip` : `/api/photos/download-zip`;
  const token = await getAuthToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ photoIds }),
  });
  if (!res.ok) throw new Error(`Failed to download ZIP: ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "photos.zip";
  a.click();
  URL.revokeObjectURL(a.href);
}
