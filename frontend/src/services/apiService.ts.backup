// This pulls the URL from GitHub Secrets/Vite environment
const API_BASE_URL = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export interface Photo {
  id: number;
  filename: string;
  thumbnailUrl: string;
  fullUrl: string;
}

export const getPhotos = async (limit: number = 100): Promise<Photo[]> => {
  const response = await fetch(`${API_BASE_URL}/api/photos?limit=${limit}`);
  if (!response.ok) throw new Error('Network response was not ok');
  return response.json();
};
