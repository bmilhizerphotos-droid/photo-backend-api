/**
 * Configuration for the API client.
 * Uses localhost in development and the production API domain in production.
 */

const isDevelopment = import.meta.env.MODE === "development";

// Ensure the base URL is a valid absolute URL and has no trailing slash
const rawBase = isDevelopment
  ? "http://127.0.0.1:3000"
  : "https://api.milhizerfamilyphotos.org";

export const API_BASE = rawBase.replace(/\/$/, "");

/**
 * Fetches an initial list of photos from the server.
 * Supports both API response shapes:
 *  - array of photos (current backend)
 *  - { photos: [...] } (older/alternate clients)
 */
export async function fetchPhotos() {
  const url = new URL("/api/photos", API_BASE);
  url.searchParams.set("limit", "20");

  const res = await fetch(url.toString(), {
    method: "GET",
    credentials: "include", // REQUIRED for Cloudflare Access session cookies
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch photos (${res.status}). Ensure the backend is running and Cloudflare Access is allowing your session.`
    );
  }

  const data = await res.json();

  if (Array.isArray(data)) return data;
  return data.photos ?? [];
}

/**
 * Helper to get the full photo URL for <img> tags.
 * Resolves relative paths to the correct backend address.
 */
export const getPhotoUrl = (p: string) => {
  if (!p) return "";
  if (p.startsWith("http")) return p;
  try {
    return new URL(p, API_BASE).toString();
  } catch (e) {
    // Fallback to simple concatenation if URL construction fails
    return `${API_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
  }
};