import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// Define the shape of a Photo object for TypeScript
interface Photo {
  id: number;
  filename: string;
  thumbnailUrl: string;
  fullUrl: string;
}

function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [offset, setOffset] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  
  // The observer tracks the last element to trigger more loading
  const observer = useRef<IntersectionObserver | null>(null);

  const LIMIT = 50;

  const fetchPhotos = useCallback(async () => {
    if (loading || !hasMore) return;
    
    setLoading(true);
    try {
      const response = await fetch(
        `https://api.milhizerfamilyphotos.org/api/photos?limit=${LIMIT}&offset=${offset}`
      );
      
      if (!response.ok) throw new Error("Network response was not ok");
      
      const data: Photo[] = await response.json();
      
      if (data.length < LIMIT) {
        setHasMore(false); // No more photos left in the database
      }
      
      // Append the new batch to the existing photos
      setPhotos(prev => [...prev, ...data]);
      setOffset(prev => prev + LIMIT);
    } catch (err) {
      console.error("Error fetching photos:", err);
    } finally {
      setLoading(false);
    }
  }, [offset, loading, hasMore]);

  // Initial load on component mount
  useEffect(() => {
    fetchPhotos();
  }, []);

  // Intersection Observer Logic
  const lastPhotoElementRef = useCallback((node: HTMLDivElement) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        fetchPhotos();
      }
    });
    
    if (node) observer.current.observe(node);
  }, [loading, hasMore, fetchPhotos]);

  return (
    <div className="App">
      <header className="header">
        <h1>Milhizer Family Photos</h1>
      </header>

      <div className="photo-grid">
        {photos.map((photo, index) => {
          // If it's the last photo in the current array, attach the observer
          if (photos.length === index + 1) {
            return (
              <div ref={lastPhotoElementRef} key={`${photo.id}-${index}`} className="photo-card">
                <img src={photo.thumbnailUrl} alt={photo.filename} loading="lazy" />
              </div>
            );
          } else {
            return (
              <div key={`${photo.id}-${index}`} className="photo-card">
                <img src={photo.thumbnailUrl} alt={photo.filename} loading="lazy" />
              </div>
            );
          }
        })}
      </div>

      {loading && (
        <div className="status-message">
          <p>Loading more memories...</p>
        </div>
      )}

      {!hasMore && (
        <div className="status-message">
          <p>You've reached the beginning of the collection!</p>
        </div>
      )}
    </div>
  );
}

export default App;
