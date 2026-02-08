// frontend/src/api.ts

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? "";

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

export async function fetchAlbums(): Promise<Album[]> {
  const res = await fetch(`${API_BASE}/api/albums`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data.albums ?? [];
}
