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
  | "duplicates"
  | "status";

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

const StatusIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
  </svg>
);

// (other icons unchanged)
const PhotosIcon = () => (/* unchanged */ <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>);
const FavoritesIcon = () => (/* unchanged */ <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>);
const PeopleIcon = () => (/* unchanged */ <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>);
const MemoriesIcon = () => (/* unchanged */ <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>);
const DuplicatesIcon = () => (/* unchanged */ <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>);
const SharedIcon = () => (/* unchanged */ <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>);
const ImportIcon = () => (/* unchanged */ <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>);
const TrashIcon = () => (/* unchanged */ <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>);

export default function Sidebar({
  view,
  onChangeView,
  albums,
  selectedAlbumId,
  onSelectAlbum,
  onCreateAlbum,
}: SidebarProps) {
  const libraryItems = [
    { id: "photos", label: "Photos", icon: <PhotosIcon /> },
    { id: "favorites", label: "Favorites", icon: <FavoritesIcon /> },
    { id: "people", label: "People", icon: <PeopleIcon /> },
    { id: "memories", label: "Memories", icon: <MemoriesIcon /> },
    { id: "duplicates", label: "Duplicates", icon: <DuplicatesIcon /> },
    { id: "status", label: "Status", icon: <StatusIcon /> },
    { id: "shared", label: "Shared", icon: <SharedIcon /> },
    { id: "import", label: "Import", icon: <ImportIcon /> },
    { id: "trash", label: "Trash", icon: <TrashIcon /> },
  ];

  return (
    <aside className="w-64 bg-white border-r h-screen sticky top-0 overflow-y-auto">
      <div className="p-4">
        <h1 className="text-lg font-bold mb-6">📸 Family Photos</h1>
        <nav className="space-y-1">
          {libraryItems.map((item) => (
            <NavItem
              key={item.id}
              id={item.id}
              label={item.label}
              icon={item.icon}
              active={view === item.id}
              onClick={() => onChangeView(item.id as AppView)}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}
