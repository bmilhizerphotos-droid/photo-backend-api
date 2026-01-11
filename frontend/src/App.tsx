import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { fetchPhotos as apiFetchPhotos } from './api';

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
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  
  const observer = useRef<IntersectionObserver | null>(null);
  const LIMIT = 50;

  const fetchPhotos = useCallback(async () => {
    if (loading || !hasMore) return;

    setLoading(true);
    try {
      const data: Photo[] = await apiFetchPhotos(LIMIT, offset);

      if (data.length < LIMIT) {
        setHasMore(false);
      }

      setPhotos(prev => [...prev, ...data]);
      setOffset(prev => prev + LIMIT);
    } catch (err) {
      console.error("Error fetching photos:", err);
    } finally {
      setLoading(false);
    }
  }, [offset, loading, hasMore]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const lastPhotoElementRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        fetchPhotos();
      }
    });
    
    if (node) observer.current.observe(node);
  }, [loading, hasMore, fetchPhotos]);

  const handlePhotoClick = (photo: Photo) => {
    console.log("Photo clicked:", photo.filename); // Check F12 console for this!
    setSelectedPhoto(photo);
  };

  return (
    <div className="App">
      <header className="header">
        <h1>Milhizer Family Photos</h1>
      </header>

      <main className="photo-grid">
        {photos.map((photo, index) => {
          const isLast = photos.length === index + 1;
          return (
            <div 
              ref={isLast ? lastPhotoElementRef : null} 
              key={`${photo.id}-${index}`} 
              className="photo-card"
              onClick={() => handlePhotoClick(photo)}
            >
              <img src={photo.thumbnailUrl} alt={photo.filename} loading="lazy" />
            </div>
          );
        })}
      </main>

      {selectedPhoto && (
        <div className="lightbox-overlay" onClick={() => setSelectedPhoto(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={selectedPhoto.fullUrl} alt={selectedPhoto.filename} />
            <button className="close-btn" onClick={() => setSelectedPhoto(null)}>&times;</button>
            <div className="filename-label">{selectedPhoto.filename}</div>
          </div>
        </div>
      )}

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
