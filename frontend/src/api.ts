/**
 * API service for Family Photo Gallery
 * Google Photos-style masonry gallery frontend
 */

import { getAuth } from 'firebase/auth';

// Environment-based API configuration
const isProduction = import.meta.env.PROD;
export const API_BASE = isProduction
  ? "https://photos.milhizerfamilyphotos.org"
  : "http://127.0.0.1:3001";

/**
 * Photo interface matching backend API response
 */
export interface Photo {
  id: number;
  filename: string;
  thumbnailUrl: string;
  fullUrl: string;
}

/**
 * Fetches photos from the backend API
 */
export async function fetchPhotos(offset = 0, limit = 50): Promise<Photo[]> {
  const auth = getAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error("User not authenticated");
  }

  const idToken = await user.getIdToken();

  const url = new URL("/api/photos", API_BASE);
  url.searchParams.set("offset", offset.toString());
  url.searchParams.set("limit", limit.toString());

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${idToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch photos: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : data.photos ?? [];
}

/**
 * Gets authenticated image URL with Firebase ID token
 */
export const getAuthenticatedImageUrl = async (imagePath: string): Promise<string> => {
  if (!imagePath) return "";

  if (imagePath.startsWith("http")) return imagePath;

  const auth = getAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error("User not authenticated");
  }

  const idToken = await user.getIdToken();

  const url = new URL("/api/photo-file", API_BASE);
  url.searchParams.set("path", encodeURIComponent(imagePath));
  url.searchParams.set("token", idToken);

  return url.toString();
};

/**
 * Preloads an image with authentication
 */
export const preloadImage = (src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = src;
  });
};