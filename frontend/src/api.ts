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
      "Cache-Control": "no-cache",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch photos: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : data.photos ?? [];
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