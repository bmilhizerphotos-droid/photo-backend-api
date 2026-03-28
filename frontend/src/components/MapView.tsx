import { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "@changey/react-leaflet-markercluster";
import L from "leaflet";
import { fetchMapPhotos, MapPhoto, getAuthToken } from "../api";

// Fix leaflet default icon paths broken by Vite bundling
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

import "leaflet/dist/leaflet.css";
import "@changey/react-leaflet-markercluster/dist/styles.min.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

function appendTokenToUrl(url: string, token: string | null): string {
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

// Auto-fit map to all markers on first load
function FitBounds({ photos }: { photos: MapPhoto[] }) {
  const map = useMap();
  useEffect(() => {
    if (photos.length === 0) return;
    const bounds = L.latLngBounds(photos.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  }, [map, photos]);
  return null;
}

interface Props {
  onOpenPhoto?: (id: number, filename: string) => void;
}

export default function MapView({ onOpenPhoto }: Props) {
  const [photos, setPhotos] = useState<MapPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    getAuthToken().then(setToken).catch(() => {});
    fetchMapPhotos()
      .then(setPhotos)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const p of photos) {
      if (p.dateTaken) s.add(new Date(p.dateTaken).getFullYear());
    }
    return Array.from(s).sort((a, b) => b - a);
  }, [photos]);

  const filtered = useMemo(() =>
    yearFilter ? photos.filter(p => p.dateTaken && new Date(p.dateTaken).getFullYear() === yearFilter) : photos,
    [photos, yearFilter]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-3">🗺️</div>
          <p className="text-sm">Loading map…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-6xl mb-4">📍</div>
        <h2 className="text-xl font-medium text-gray-700 mb-2">No GPS data found</h2>
        <p className="text-sm text-gray-500 max-w-sm">Photos with location data will appear here on the map.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 pb-2 flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Map</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {filtered.length.toLocaleString()} photo{filtered.length !== 1 ? "s" : ""} with location data
            {yearFilter ? ` in ${yearFilter}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setYearFilter(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              yearFilter === null ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All years
          </button>
          {years.slice(0, 12).map(y => (
            <button
              key={y}
              onClick={() => setYearFilter(y === yearFilter ? null : y)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                yearFilter === y ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {y}
            </button>
          ))}
          {years.length > 12 && (
            <span className="text-xs text-gray-400">+{years.length - 12} more</span>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-h-0 mx-4 mb-4 rounded-xl overflow-hidden border border-gray-200 shadow-sm" style={{ height: "calc(100vh - 140px)" }}>
        <MapContainer
          center={[39.5, -98.35]}
          zoom={4}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds photos={filtered} />
          <MarkerClusterGroup chunkedLoading>
            {filtered.map(photo => (
              <Marker key={photo.id} position={[photo.lat, photo.lng]}>
                <Popup>
                  <div className="text-center" style={{ minWidth: 140 }}>
                    <img
                      src={appendTokenToUrl(`${API_BASE}/thumbnails/${photo.id}`, token)}
                      alt={photo.filename}
                      style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 6, display: "block", marginBottom: 6 }}
                    />
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>
                      {photo.dateTaken ? new Date(photo.dateTaken).toLocaleDateString() : photo.filename}
                    </div>
                    {onOpenPhoto && (
                      <button
                        onClick={() => onOpenPhoto(photo.id, photo.filename)}
                        style={{ fontSize: 12, color: "#2563eb", textDecoration: "underline", cursor: "pointer", background: "none", border: "none" }}
                      >
                        View full photo
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        </MapContainer>
      </div>
    </div>
  );
}
