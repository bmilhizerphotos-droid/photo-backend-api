import { useEffect, useState } from "react";
import { getPhotos, Photo } from "./services/apiService";
import "./App.css";

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selected, setSelected] = useState<Photo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    setLoading(true);
    getPhotos(200)
      .then((data) => {
        setPhotos(data);
        setError(null);
      })
      .catch((err) => {
        console.error("Failed to load photos:", err);
        setError("Failed to load photos. Please check if your local server and Cloudflare tunnel are running.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div className="app">
      <h1>📸 Family Photo Gallery</h1>

      {loading && <p className="loading">Loading photos from home server...</p>}
      
      {error && (
        <div className="error-container">
          <p className="error">{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      {!loading && photos.length === 0 && !error && (
        <p className="no-photos">No photos found. Check your photos.db file locally.</p>
      )}

      <div className="grid">
        {photos.map((photo) => (
          <img
            key={photo.id}
            src={photo.thumbnailUrl}
            alt={photo.filename}
            className="thumb"
            loading="lazy"
            onClick={() => setSelected(photo)}
          />
        ))}
      </div>

      {selected && (
        <div className="modal" onClick={() => setSelected(null)}>
          <div className="modal-content">
            <img
              src={selected.fullUrl || selected.thumbnailUrl}
              alt={selected.filename}
              className="full"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="modal-info">
              <p>{selected.filename}</p>
            </div>
            <button className="close" onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
