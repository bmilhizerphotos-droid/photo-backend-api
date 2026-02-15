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

export async function fetchPhotos(offset = 0, limit = 50): Promise<Photo[]> {
  const url = API_BASE
    ? `${API_BASE}/api/photos?offset=${offset}&limit=${limit}`
    : `/api/photos?offset=${offset}&limit=${limit}`;

  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch photos: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return data.photos ?? data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Timeout fetching photos");
    } else {
      console.error("Error fetching photos:", error);
    }
    // Return empty array on failure to prevent app crash
    return [];
  }
}

/* =====================
   ALBUMS
   ===================== */

export async function fetchAlbums(): Promise<Album[]> {
  const url = API_BASE ? `${API_BASE}/api/albums` : `/api/albums`;
  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch albums: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Timeout fetching albums");
    } else {
      console.error("Error fetching albums:", error);
    }
    return [];
  }
}

/* =====================
   PEOPLE
   ===================== */

export async function fetchPeople(): Promise<Person[]> {
  const url = API_BASE ? `${API_BASE}/api/people` : `/api/people`;
  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch people: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Timeout fetching people");
    } else {
      console.error("Error fetching people:", error);
    }
    return [];
  }
}

export async function fetchPersonPhotos(personId: number): Promise<Photo[]> {
  const url = API_BASE
    ? `${API_BASE}/api/people/${personId}/photos`
    : `/api/people/${personId}/photos`;

  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch person photos: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    // Ensure we always return an array, even if the API returns a single photo object
    if (Array.isArray(data)) {
      return data;
    } else if (data.photos && Array.isArray(data.photos)) {
      return data.photos;
    } else {
      return [];
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Timeout fetching person photos");
    } else {
      console.error("Error fetching person photos:", error);
    }
    return [];
  }
}

/* =====================
   SEARCH
   ===================== */

export async function searchPhotos(query: string): Promise<Photo[]> {
  const url = API_BASE
    ? `${API_BASE}/api/search?q=${encodeURIComponent(query)}`
    : `/api/search?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    if (!res.ok) {
      throw new Error(`Search failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return Array.isArray(data?.photos) ? data.photos : [];
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Timeout searching photos");
    } else {
      console.error("Error searching photos:", error);
    }
    return [];
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
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch unidentified count: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Timeout fetching unidentified count");
    } else {
      console.error("Error fetching unidentified count:", error);
    }
    return { photoCount: 0, faceCount: 0 };
  }
}
