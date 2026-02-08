// frontend/src/api.ts

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? "";

export interface Photo {
  id: number;
  filename: string;
  thumbnail_url: string;
  image_url: string;
}

export async function fetchPhotos(offset = 0, limit = 50) {
  const res = await fetch(
    `${API_BASE}/api/photos?offset=${offset}&limit=${limit}`,
    { credentials: "include" }
  );

  if (!res.ok) {
    throw new Error("Failed to fetch photos");
  }

  const data = await res.json();
  return data.photos ?? data;
}
