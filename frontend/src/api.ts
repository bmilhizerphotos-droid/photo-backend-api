// frontend/src/api.ts

// IMPORTANT:
// - In dev: use relative /api (Vite proxy → no CORS)
// - In prod: VITE_API_BASE_URL is injected at build time
const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";

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

export interface Album {
  id: number;
  name: string;
  description: string | null;
  coverPhotoId: number | null;
  coverPhotoUrl: string | null;
  photoCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: number;
  name: string;
  photoCount: number;
  thumbnailUrl: string | null;
}

/* =====================
   PHOTOS
   ===================== */

export async function fetchPhotos(offset = 0, limit = 50) {
  const url = API_BASE
    ? `${API_BASE}/api/photos?offset=${offset}&limit=${limit}`
    : `/api/photos?offset=${offset}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch photos");
  }
  const data = await res.json();
  return data.photos ?? data;
}

/* =====================
   ALBUMS
   ===================== */

export async function fetchAlbums(): Promise<Album[]> {
  const url = API_BASE ? `${API_BASE}/api/albums` : `/api/albums`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

/* =====================
   PEOPLE
   ===================== */

export async function fetchPeople(): Promise<Person[]> {
  const url = API_BASE ? `${API_BASE}/api/people` : `/api/people`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch people");
  }
  return res.json();
}

export async function fetchPersonPhotos(personId: number) {
  const url = API_BASE
    ? `${API_BASE}/api/people/${personId}/photos`
    : `/api/people/${personId}/photos`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch person photos");
  }
  return res.json();
}

/* =====================
   SEARCH
   ===================== */

export async function searchPhotos(query: string): Promise<Photo[]> {
  const url = API_BASE
    ? `${API_BASE}/api/search?q=${encodeURIComponent(query)}`
    : `/api/search?q=${encodeURIComponent(query)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Search failed");
  }
  const data = await res.json();
  return Array.isArray(data?.photos) ? data.photos : [];
}

export async function fetchUnidentifiedCount(): Promise<{
  photoCount: number;
  faceCount: number;
}> {
  const url = API_BASE
    ? `${API_BASE}/api/people/unidentified`
    : `/api/people/unidentified`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch unidentified count");
  }
  return res.json();
}
