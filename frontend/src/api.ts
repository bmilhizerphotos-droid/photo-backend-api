/**
 * API service for Family Photo Gallery
 * Google Photos-style masonry gallery frontend
 */

import { auth } from './firebase';

// Use relative URLs - Vite proxy will handle routing to backend
export const API_BASE = "";

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
  // Temporarily disable authentication for testing
  // const user = auth.currentUser;
  // if (!user) {
  //   throw new Error("User not authenticated");
  // }
  // const idToken = await user.getIdToken();

  const url = new URL("/api/photos", API_BASE);
  url.searchParams.set("offset", offset.toString());
  url.searchParams.set("limit", limit.toString());

  const res = await fetch(url.toString(), {
    method: "GET",
    // Temporarily remove auth header for testing
    // headers: {
    //   "Authorization": `Bearer ${idToken}`,
    // },
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