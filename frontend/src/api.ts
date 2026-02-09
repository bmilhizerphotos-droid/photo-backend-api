// frontend/src/api.ts

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? "";

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
  photoCount: number;
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
  const res = await fetch(
    `${API_BASE}/api/photos?offset=${offset}&limit=${limit}`
  );
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
  const res = await fetch(`${API_BASE}/api/albums`);
  if (!res.ok) return [];
  return res.json();
}

/* =====================
   PEOPLE
   ===================== */

export async function fetchPeople(): Promise<Person[]> {
  const res = await fetch(`${API_BASE}/api/people`);
  if (!res.ok) {
    throw new Error("Failed to fetch people");
  }
  return res.json();
}

export async function fetchPersonPhotos(personId: number) {
  const res = await fetch(`${API_BASE}/api/people/${personId}/photos`);
  if (!res.ok) {
    throw new Error("Failed to fetch person photos");
  }
  return res.json();
}

export async function fetchUnidentifiedCount(): Promise<{
  photoCount: number;
  faceCount: number;
}> {
  const res = await fetch(`${API_BASE}/api/people/unidentified`);
  if (!res.ok) {
    throw new Error("Failed to fetch unidentified count");
  }
  return res.json();
}
