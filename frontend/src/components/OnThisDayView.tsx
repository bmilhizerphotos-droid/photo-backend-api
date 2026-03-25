import { useState, useEffect } from "react";
import { fetchOnThisDay, OnThisDayGroup } from "../api";
import { ImageModal } from "./ImageModal";

export default function OnThisDayView() {
  const [groups, setGroups] = useState<OnThisDayGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalPhoto, setModalPhoto] = useState<any>(null);

  useEffect(() => {
    fetchOnThisDay()
      .then((data) => { setGroups(data.groups); setTotal(data.total); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const currentYear = new Date().getFullYear();

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">On This Day</h1>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 animate-pulse">
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="aspect-square bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">On This Day</h1>
        <p className="text-sm text-gray-500 mt-1">
          {total > 0
            ? `${total} photo${total !== 1 ? "s" : ""} taken on ${today} across ${groups.length} year${groups.length !== 1 ? "s" : ""}`
            : `No photos taken on ${today} in previous years`}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {groups.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-6xl mb-4">📅</div>
          <h2 className="text-xl font-medium text-gray-700 mb-2">No memories yet for {today}</h2>
          <p className="text-sm text-gray-500 max-w-sm">
            Photos taken on this date in previous years will appear here.
          </p>
        </div>
      )}

      <div className="space-y-10">
        {groups.map((group) => (
          <section key={group.year}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-lg font-semibold text-gray-800">{group.year}</h2>
              <span className="text-sm text-gray-400">
                {currentYear - group.year} year{currentYear - group.year !== 1 ? "s" : ""} ago
              </span>
              <span className="text-xs text-gray-400">· {group.photos.length} photo{group.photos.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
              {group.photos.map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => setModalPhoto({ ...photo, image_url: photo.thumbnailUrl.replace("/thumbnails/", "/api/photos/").replace(/\/(\d+)$/, "/$1/file") })}
                  className="aspect-square rounded overflow-hidden bg-gray-100 hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <img
                    src={photo.thumbnailUrl}
                    alt={photo.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <ImageModal photo={modalPhoto} onClose={() => setModalPhoto(null)} />
    </div>
  );
}
