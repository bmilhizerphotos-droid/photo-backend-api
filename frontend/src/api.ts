// FILE: frontend/src/api.ts
/**
 * API service for Family Photo Gallery
 * Authentication: uses Firebase Auth tokens
 */

import { auth } from './firebase';

function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s.replace(/\/+$/, "");
}

function buildUrl(path: string): string {
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;

  // Dev: relative URLs so Vite proxy works (/api, /photos, /thumbnails)
  if (isDev) return path.startsWith("/") ? path : `/${path}`;

  // Prod: absolute if provided
  if (baseFromEnv) {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, baseFromEnv);
    return url.toString();
  }

  // Fallback: relative
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Get the current user's Firebase ID token
 */
async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    return await user.getIdToken();
  } catch (error) {
    console.error("Failed to get auth token:", error);
    return null;
  }
}

/**
 * Build an authenticated thumbnail URL for use in img src
 * Returns null if not authenticated
 */
export async function buildThumbnailUrl(photoId: number): Promise<string | null> {
  const token = await getAuthToken();
  if (!token) return null;

  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;
  const authParams = `token=${encodeURIComponent(token)}&v=${Date.now()}`;

  let thumbnailUrl = `/thumbnails/${photoId}`;
  if (isDev) {
    return `${thumbnailUrl}?${authParams}`;
  } else if (baseFromEnv) {
    return `${baseFromEnv}${thumbnailUrl}?${authParams}`;
  }
  return `${thumbnailUrl}?${authParams}`;
}

export interface Photo {
  id: number;
  filename: string;
  thumbnailUrl: string;
  fullUrl: string;
  isFavorite?: boolean;
  albumIds?: number[];
  createdAt?: string;
}

export async function fetchPhotos(offset = 0, limit = 50): Promise<Photo[]> {
  const token = await getAuthToken();

  if (!token) {
    throw new Error("Not authenticated");
  }

  const res = await fetch(buildUrl(`/api/photos?offset=${offset}&limit=${limit}`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch photos: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const photos: Photo[] = Array.isArray(data) ? data : data.photos ?? [];

  // Authenticate thumbnail and full URLs so <img> tags can load them
  // (browser img tags can't send Authorization headers, so we use query param tokens)
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;
  const cacheBuster = String(Date.now());

  return photos.map(photo => {
    const authParams = `token=${encodeURIComponent(token)}&v=${cacheBuster}`;

    // Build authenticated thumbnail URL
    let thumbnailUrl = photo.thumbnailUrl;
    if (thumbnailUrl) {
      if (isDev) {
        thumbnailUrl = `${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}${authParams}`;
      } else if (baseFromEnv) {
        thumbnailUrl = `${baseFromEnv}${thumbnailUrl.startsWith('/') ? '' : '/'}${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}${authParams}`;
      }
    }

    // Build authenticated full URL
    let fullUrl = photo.fullUrl;
    if (fullUrl) {
      if (isDev) {
        fullUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${authParams}`;
      } else if (baseFromEnv) {
        fullUrl = `${baseFromEnv}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${authParams}`;
      }
    }

    return {
      ...photo,
      thumbnailUrl,
      fullUrl,
    };
  });
}

/**
 * Get authenticated image URL with token
 * Uses URL API to safely build query parameters without manual string concatenation
 */
export async function getAuthenticatedImageUrl(relativeOrAbsolute: string): Promise<string> {
  if (!relativeOrAbsolute) return "";
  
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");
  
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  
  // Resolve relative URLs against API base in prod; in dev, allow relative for proxy.
  const isDev = import.meta.env.DEV;
  const url = /^https?:\/\//i.test(relativeOrAbsolute)
    ? new URL(relativeOrAbsolute)
    : isDev
      ? new URL(relativeOrAbsolute, window.location.origin)
      : new URL(relativeOrAbsolute, baseFromEnv || (() => { throw new Error("Missing VITE_API_BASE_URL in production"); })());
  
  // Safely add query parameters - URL API handles existing params correctly
  url.searchParams.set("token", token);
  url.searchParams.set("v", String(Date.now()));
  
  return url.toString();
}

export const preloadImage = (src: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = src;
  });

// ============== PEOPLE API ==============

export interface Person {
  id: number;
  name: string;
  photoCount: number;
  thumbnailUrl: string | null;
}

export interface PersonWithPhotos extends Person {
  photos: Photo[];
}

/**
 * Fetch all people with photo counts
 */
export async function fetchPeople(): Promise<Person[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl("/api/people"), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch people: ${res.status} ${res.statusText}`);
  }

  const people: Person[] = await res.json();

  // Authenticate thumbnail URLs
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;
  const authParams = `token=${encodeURIComponent(token)}&v=${Date.now()}`;

  return people.map(person => {
    let thumbnailUrl = person.thumbnailUrl;
    if (thumbnailUrl) {
      if (isDev) {
        thumbnailUrl = `${thumbnailUrl}?${authParams}`;
      } else if (baseFromEnv) {
        thumbnailUrl = `${baseFromEnv}${thumbnailUrl}?${authParams}`;
      }
    }
    return { ...person, thumbnailUrl };
  });
}

/**
 * Fetch photos for a specific person
 */
export async function fetchPersonPhotos(personId: number, offset = 0, limit = 50): Promise<Photo[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/people/${personId}/photos?offset=${offset}&limit=${limit}`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch person photos: ${res.status} ${res.statusText}`);
  }

  const photos: Photo[] = await res.json();

  // Authenticate thumbnail and full URLs
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;
  const cacheBuster = String(Date.now());

  return photos.map(photo => {
    const authParams = `token=${encodeURIComponent(token)}&v=${cacheBuster}`;

    let thumbnailUrl = photo.thumbnailUrl;
    if (thumbnailUrl) {
      if (isDev) {
        thumbnailUrl = `${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}${authParams}`;
      } else if (baseFromEnv) {
        thumbnailUrl = `${baseFromEnv}${thumbnailUrl.startsWith('/') ? '' : '/'}${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}${authParams}`;
      }
    }

    let fullUrl = photo.fullUrl;
    if (fullUrl) {
      if (isDev) {
        fullUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${authParams}`;
      } else if (baseFromEnv) {
        fullUrl = `${baseFromEnv}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${authParams}`;
      }
    }

    return { ...photo, thumbnailUrl, fullUrl };
  });
}

// ============== FACE DETECTION & TAGGING API ==============

export interface PhotoWithFaces extends Photo {
  unidentifiedCount: number;
  totalFaces: number;
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

export interface UnidentifiedPhotosResponse {
  photos: PhotoWithFaces[];
  total: number;
}

export interface UnidentifiedCountResponse {
  photoCount: number;
  faceCount: number;
}

/**
 * Fetch photos with unidentified faces
 */
export async function fetchUnidentifiedPhotos(offset = 0, limit = 50): Promise<UnidentifiedPhotosResponse> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/faces/unidentified?offset=${offset}&limit=${limit}`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch unidentified photos: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  // Authenticate thumbnail and full URLs
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;
  const cacheBuster = String(Date.now());

  const photos = data.photos.map((photo: PhotoWithFaces) => {
    const authParams = `token=${encodeURIComponent(token)}&v=${cacheBuster}`;

    let thumbnailUrl = photo.thumbnailUrl;
    if (thumbnailUrl) {
      if (isDev) {
        thumbnailUrl = `${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}${authParams}`;
      } else if (baseFromEnv) {
        thumbnailUrl = `${baseFromEnv}${thumbnailUrl.startsWith('/') ? '' : '/'}${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}${authParams}`;
      }
    }

    let fullUrl = photo.fullUrl;
    if (fullUrl) {
      if (isDev) {
        fullUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${authParams}`;
      } else if (baseFromEnv) {
        fullUrl = `${baseFromEnv}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${authParams}`;
      }
    }

    return { ...photo, thumbnailUrl, fullUrl };
  });

  return { photos, total: data.total };
}

/**
 * Fetch count of unidentified faces
 */
export async function fetchUnidentifiedCount(): Promise<UnidentifiedCountResponse> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl("/api/faces/unidentified/count"), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch unidentified count: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Fetch detected faces for a photo
 */
export async function fetchPhotoFaces(photoId: number): Promise<Face[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/photos/${photoId}/faces`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch photo faces: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Fetch people tagged in a photo
 */
export async function fetchPhotoTaggedPeople(photoId: number): Promise<Person[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/photos/${photoId}/people`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch photo people: ${res.status} ${res.statusText}`);
  }

  const people: Person[] = await res.json();

  // Authenticate thumbnail URLs
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;
  const authParams = `token=${encodeURIComponent(token)}&v=${Date.now()}`;

  return people.map(person => {
    let thumbnailUrl = person.thumbnailUrl;
    if (thumbnailUrl) {
      if (isDev) {
        thumbnailUrl = `${thumbnailUrl}?${authParams}`;
      } else if (baseFromEnv) {
        thumbnailUrl = `${baseFromEnv}${thumbnailUrl}?${authParams}`;
      }
    }
    return { ...person, thumbnailUrl };
  });
}

/**
 * Identify a face (assign to an existing person)
 */
export async function identifyFace(faceId: number, personId: number): Promise<{ success: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/faces/${faceId}/identify`), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ personId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to identify face: ${res.status}`);
  }

  return res.json();
}

/**
 * Create a new person from a face
 */
export async function createPersonFromFace(faceId: number, name: string): Promise<{ success: boolean; person: Person }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/faces/${faceId}/create-person`), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to create person: ${res.status}`);
  }

  return res.json();
}

/**
 * Manually tag a person in a photo (without face detection)
 */
export async function tagPersonInPhoto(photoId: number, personId: number): Promise<{ success: boolean; added: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/photos/${photoId}/tag`), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ personId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to tag photo: ${res.status}`);
  }

  return res.json();
}

/**
 * Remove a person tag from a photo
 */
export async function removePersonTagFromPhoto(photoId: number, personId: number): Promise<{ success: boolean; removed: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/photos/${photoId}/tag/${personId}`), {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to remove tag: ${res.status}`);
  }

  return res.json();
}

/**
 * Bulk tag photos with a person
 */
export async function bulkTagPhotos(photoIds: number[], personId: number): Promise<{ success: boolean; added: number; skipped: number }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl("/api/photos/bulk/tag"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ photoIds, personId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to bulk tag photos: ${res.status}`);
  }

  return res.json();
}

/**
 * Search people by name
 */
export async function searchPeople(query: string): Promise<Person[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/people/search?q=${encodeURIComponent(query)}`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to search people: ${res.status} ${res.statusText}`);
  }

  const people: Person[] = await res.json();

  // Authenticate thumbnail URLs
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;
  const authParams = `token=${encodeURIComponent(token)}&v=${Date.now()}`;

  return people.map(person => {
    let thumbnailUrl = person.thumbnailUrl;
    if (thumbnailUrl) {
      if (isDev) {
        thumbnailUrl = `${thumbnailUrl}?${authParams}`;
      } else if (baseFromEnv) {
        thumbnailUrl = `${baseFromEnv}${thumbnailUrl}?${authParams}`;
      }
    }
    return { ...person, thumbnailUrl };
  });
}

// ============== ALBUMS API ==============

export interface Album {
  id: number;
  name: string;
  description: string | null;
  coverPhotoId: number | null;
  coverPhotoUrl: string | null;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AlbumWithPhotos extends Album {
  photos: Photo[];
}

/**
 * Fetch all albums for the current user
 */
export async function fetchAlbums(): Promise<Album[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl("/api/albums"), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch albums: ${res.status} ${res.statusText}`);
  }

  const albums = await res.json();

  // Add authenticated cover photo URLs
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;
  const authParams = `token=${encodeURIComponent(token)}&v=${Date.now()}`;

  return albums.map((album: Album) => {
    if (!album.coverPhotoId) {
      return { ...album, coverPhotoUrl: null };
    }

    let coverPhotoUrl = `/thumbnails/${album.coverPhotoId}`;
    if (isDev) {
      coverPhotoUrl = `${coverPhotoUrl}?${authParams}`;
    } else if (baseFromEnv) {
      coverPhotoUrl = `${baseFromEnv}${coverPhotoUrl}?${authParams}`;
    } else {
      coverPhotoUrl = `${coverPhotoUrl}?${authParams}`;
    }

    return { ...album, coverPhotoUrl };
  });
}

/**
 * Fetch a specific album with its photos
 */
export async function fetchAlbum(albumId: number): Promise<AlbumWithPhotos> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/albums/${albumId}`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch album: ${res.status} ${res.statusText}`);
  }

  const album = await res.json();

  // Authenticate photo URLs
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;
  const cacheBuster = String(Date.now());

  const photos = album.photos.map((photo: Photo) => {
    const authParams = `token=${encodeURIComponent(token)}&v=${cacheBuster}`;

    // Build authenticated thumbnail URL
    let thumbnailUrl = `/thumbnails/${photo.id}`;
    if (isDev) {
      thumbnailUrl = `${thumbnailUrl}?${authParams}`;
    } else if (baseFromEnv) {
      thumbnailUrl = `${baseFromEnv}${thumbnailUrl}?${authParams}`;
    }

    // Build authenticated full URL
    let fullUrl = `/photos/${photo.id}`;
    if (isDev) {
      fullUrl = `${fullUrl}?${authParams}`;
    } else if (baseFromEnv) {
      fullUrl = `${baseFromEnv}${fullUrl}?${authParams}`;
    }

    return { ...photo, thumbnailUrl, fullUrl };
  });

  return { ...album, photos };
}

/**
 * Create a new album
 */
export async function createAlbum(name: string, description?: string): Promise<Album> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl("/api/albums"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, description }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to create album: ${res.status}`);
  }

  return res.json();
}

/**
 * Update an album
 */
export async function updateAlbum(
  albumId: number,
  updates: { name?: string; description?: string; coverPhotoId?: number | null }
): Promise<{ success: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/albums/${albumId}`), {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to update album: ${res.status}`);
  }

  return res.json();
}

/**
 * Delete an album
 */
export async function deleteAlbum(albumId: number): Promise<{ success: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/albums/${albumId}`), {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to delete album: ${res.status}`);
  }

  return res.json();
}

/**
 * Add a photo to an album
 */
export async function addPhotoToAlbum(albumId: number, photoId: number): Promise<{ success: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/albums/${albumId}/photos`), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ photoId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to add photo to album: ${res.status}`);
  }

  return res.json();
}

/**
 * Bulk add photos to an album
 */
export async function addPhotosToAlbum(albumId: number, photoIds: number[]): Promise<{ success: boolean; added: number }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/albums/${albumId}/photos/bulk`), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ photoIds }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to add photos to album: ${res.status}`);
  }

  return res.json();
}

/**
 * Remove a photo from an album
 */
export async function removePhotoFromAlbum(albumId: number, photoId: number): Promise<{ success: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/albums/${albumId}/photos/${photoId}`), {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to remove photo from album: ${res.status}`);
  }

  return res.json();
}

// ============== MEMORIES API ==============

export interface Memory {
  id: number;
  title: string;
  narrative: string | null;
  coverPhotoId: number | null;
  coverPhotoUrl: string | null;
  photoCount: number;
  eventDateStart: string;
  eventDateEnd: string;
  locationLabel: string | null;
}

export interface MemoryWithPhotos extends Memory {
  photos: Photo[];
}

/**
 * Fetch all memories (newest first)
 */
export async function fetchMemories(): Promise<Memory[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl("/api/memories"), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch memories: ${res.status} ${res.statusText}`);
  }

  const memories: Memory[] = await res.json();

  // The server already includes auth tokens in coverPhotoUrl via query params,
  // but for dev proxy we need to ensure the URL works.
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;

  return memories.map(memory => {
    let coverPhotoUrl = memory.coverPhotoUrl;
    if (coverPhotoUrl && !isDev && baseFromEnv) {
      coverPhotoUrl = `${baseFromEnv}${coverPhotoUrl}`;
    }
    return { ...memory, coverPhotoUrl };
  });
}

/**
 * Fetch a single memory with its photos
 */
export async function fetchMemory(id: number): Promise<MemoryWithPhotos> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/memories/${id}`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch memory: ${res.status} ${res.statusText}`);
  }

  const memory = await res.json();

  // Authenticate photo URLs for production
  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;

  let coverPhotoUrl = memory.coverPhotoUrl;
  if (coverPhotoUrl && !isDev && baseFromEnv) {
    coverPhotoUrl = `${baseFromEnv}${coverPhotoUrl}`;
  }

  const photos = memory.photos.map((photo: Photo) => {
    let thumbnailUrl = photo.thumbnailUrl;
    let fullUrl = photo.fullUrl;
    if (!isDev && baseFromEnv) {
      if (thumbnailUrl) thumbnailUrl = `${baseFromEnv}${thumbnailUrl}`;
      if (fullUrl) fullUrl = `${baseFromEnv}${fullUrl}`;
    }
    return { ...photo, thumbnailUrl, fullUrl };
  });

  return { ...memory, coverPhotoUrl, photos };
}

/**
 * Search memories via FTS5
 */
export async function searchMemories(query: string): Promise<Memory[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/memories/search?q=${encodeURIComponent(query)}`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  }

  const memories: Memory[] = await res.json();

  const baseFromEnv = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const isDev = import.meta.env.DEV;

  return memories.map(memory => {
    let coverPhotoUrl = memory.coverPhotoUrl;
    if (coverPhotoUrl && !isDev && baseFromEnv) {
      coverPhotoUrl = `${baseFromEnv}${coverPhotoUrl}`;
    }
    return { ...memory, coverPhotoUrl };
  });
}

/**
 * Full memory regeneration: delete all, re-cluster, enrich with AI
 */
export async function regenerateMemoriesApi(): Promise<{ created: number; enriched: number }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl("/api/memories/regenerate"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirm: true }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to regenerate memories: ${res.status}`);
  }

  return res.json();
}

/**
 * Trigger memory generation (clustering + narrative generation)
 */
export async function generateMemoriesApi(): Promise<{ created: number; skipped: number; narrativesGenerated: number }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl("/api/memories/generate"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to generate memories: ${res.status}`);
  }

  return res.json();
}

/**
 * Delete a memory
 */
export async function deleteMemory(id: number): Promise<{ success: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/memories/${id}`), {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to delete memory: ${res.status}`);
  }

  return res.json();
}

/**
 * Update a memory (title, narrative, locationLabel, coverPhotoId)
 */
export async function updateMemory(
  id: number,
  updates: { title?: string; narrative?: string | null; locationLabel?: string | null; coverPhotoId?: number | null }
): Promise<{ success: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/memories/${id}`), {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to update memory: ${res.status}`);
  }

  return res.json();
}

/**
 * Generate AI title/narrative/location for a single memory (returns suggestions, does not save)
 */
export async function generateMemoryNarrative(id: number): Promise<{ title: string | null; narrative: string | null; locationLabel: string | null }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/memories/${id}/generate`), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to generate narrative: ${res.status}`);
  }

  return res.json();
}

// ============== TAGS API ==============

export interface Tag {
  id: number;
  name: string;
  type: 'user' | 'ai' | 'person';
  color?: string | null;
  addedBy?: string;
  addedAt?: string;
}

/**
 * Fetch all tags (optionally filtered)
 */
export async function fetchTags(type?: string, query?: string): Promise<Tag[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (query) params.set('q', query);

  const res = await fetch(buildUrl(`/api/tags?${params.toString()}`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch tags: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Create a new tag
 */
export async function createTag(name: string, type: 'user' | 'ai' | 'person' = 'user', color?: string): Promise<Tag> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl("/api/tags"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, type, color }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to create tag: ${res.status}`);
  }

  return res.json();
}

/**
 * Fetch tags for a specific photo
 */
export async function fetchPhotoTags(photoId: number): Promise<Tag[]> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/photos/${photoId}/tags`), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch photo tags: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Add a tag to a photo
 */
export async function addTagToPhoto(
  photoId: number,
  tagIdOrName: number | string,
  tagType: 'user' | 'ai' | 'person' = 'user'
): Promise<{ success: boolean; tag: Tag }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const body = typeof tagIdOrName === 'number'
    ? { tagId: tagIdOrName }
    : { tagName: tagIdOrName, tagType };

  const res = await fetch(buildUrl(`/api/photos/${photoId}/tags`), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to add tag: ${res.status}`);
  }

  return res.json();
}

/**
 * Remove a tag from a photo
 */
export async function removeTagFromPhoto(photoId: number, tagId: number): Promise<{ success: boolean }> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(buildUrl(`/api/photos/${photoId}/tags/${tagId}`), {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Failed to remove tag: ${res.status}`);
  }

  return res.json();
}