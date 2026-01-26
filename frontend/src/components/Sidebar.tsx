import React from "react";
import { Album } from "../api";

export type AppView =
  | "photos"
  | "favorites"
  | "people"
  | "memories"
  | "memory-detail"
  | "shared"
  | "import"
  | "trash"
  | "albums"
  | "album-detail"
  | "unidentified"
  | "duplicates";

interface SidebarProps {
  view: AppView;
  onChangeView: (v: AppView) => void;
  albums: Album[];
  selectedAlbumId: number | null;
  onSelectAlbum: (albumId: number) => void;
  onCreateAlbum: () => void;
}

interface NavItemProps {
  id: AppView;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: number;
}

function NavItem({ label, icon, active, onClick, badge }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 font-semibold"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      <span className="w-5 h-5 flex items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
    </button>
  );
}

// Icons as simple SVG components
const PhotosIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const FavoritesIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);

const PeopleIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

const MemoriesIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const SharedIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
  </svg>
);

const ImportIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const DuplicatesIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const AlbumIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

export default function Sidebar({
  view,
  onChangeView,
  albums,
  selectedAlbumId,
  onSelectAlbum,
  onCreateAlbum,
}: SidebarProps) {
  const libraryItems: { id: AppView; label: string; icon: React.ReactNode }[] = [
    { id: "photos", label: "Photos", icon: <PhotosIcon /> },
    { id: "favorites", label: "Favorites", icon: <FavoritesIcon /> },
    { id: "people", label: "People", icon: <PeopleIcon /> },
    { id: "memories", label: "Memories", icon: <MemoriesIcon /> },
    { id: "duplicates", label: "Duplicates", icon: <DuplicatesIcon /> },
    { id: "shared", label: "Shared", icon: <SharedIcon /> },
    { id: "import", label: "Import", icon: <ImportIcon /> },
    { id: "trash", label: "Trash", icon: <TrashIcon /> },
  ];

  return (
    <aside className="w-64 flex-shrink-0 bg-white border-r border-gray-200 h-screen sticky top-0 overflow-y-auto">
      <div className="p-4">
        {/* App Title */}
        <div className="flex items-center gap-2 mb-6 px-2">
          <span className="text-2xl">📸</span>
          <h1 className="text-lg font-bold text-gray-900">Family Photos</h1>
        </div>

        {/* Library Section */}
        <div className="mb-6">
          <h2 className="px-3 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Library
          </h2>
          <nav className="space-y-1">
            {libraryItems.map((item) => (
              <NavItem
                key={item.id}
                id={item.id}
                label={item.label}
                icon={item.icon}
                active={view === item.id}
                onClick={() => onChangeView(item.id)}
              />
            ))}
          </nav>
        </div>

        {/* Albums Section */}
        <div>
          <div className="flex items-center justify-between px-3 mb-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Albums
            </h2>
            <button
              onClick={onCreateAlbum}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Create album"
            >
              <PlusIcon />
            </button>
          </div>
          <nav className="space-y-1">
            <NavItem
              id="albums"
              label="All Albums"
              icon={<AlbumIcon />}
              active={view === "albums"}
              onClick={() => onChangeView("albums")}
              badge={albums.length}
            />

            {/* Individual Albums */}
            {albums.length > 0 && (
              <div className="mt-2 space-y-1">
                {albums.map((album) => (
                  <button
                    key={album.id}
                    onClick={() => onSelectAlbum(album.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                      view === "album-detail" && selectedAlbumId === album.id
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <span className="w-5 h-5 flex items-center justify-center text-gray-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </span>
                    <span className="flex-1 truncate">{album.name}</span>
                    <span className="text-xs text-gray-400">{album.photoCount}</span>
                  </button>
                ))}
              </div>
            )}
          </nav>
        </div>
      </div>
    </aside>
  );
}
