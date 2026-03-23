import React from "react";
import { Album } from "../api";

export type AppView =
  | "photos"
  | "memories"
  | "memory-detail"
  | "albums"
  | "album-detail"
  | "documents"
  | "screenshots"
  | "favorites"
  | "people"
  | "unidentified"
  | "person-detail"
  | "places"
  | "videos"
  | "recently-added"
  | "shared"
  | "import"
  | "trash"
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

function NavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 font-semibold"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-current">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

/* ── Icons ── */
const Icon = ({ d, fill = false }: { d: string | string[]; fill?: boolean }) => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"} strokeWidth={1.5}
    strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
  </svg>
);

const PhotosIcon        = () => <Icon d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />;
const MemoriesIcon      = () => <Icon d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />;
const AlbumsIcon        = () => <Icon d={["M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"]} />;
const DocumentsIcon     = () => <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />;
const ScreenshotsIcon   = () => <Icon d={["M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"]} />;
const FavoritesIcon     = () => <Icon d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />;
const PeopleIcon        = () => <Icon d={["M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"]} />;
const PlacesIcon        = () => <Icon d={["M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z", "M15 11a3 3 0 11-6 0 3 3 0 016 0z"]} />;
const VideosIcon        = () => <Icon d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />;
const RecentIcon        = () => <Icon d={["M12 8v4l3 3", "M3.05 11a9 9 0 1 0 .5-3"]} />;
const SharedIcon        = () => <Icon d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />;
const ImportIcon        = () => <Icon d={["M12 4v12m0 0l-4-4m4 4l4-4", "M4 20h16"]} />;
const TrashIcon         = () => <Icon d={["M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"]} />;

const NAV_ITEMS: { id: AppView; label: string; icon: React.ReactNode }[] = [
  { id: "photos",         label: "Photos",                  icon: <PhotosIcon /> },
  { id: "memories",       label: "Memories",                icon: <MemoriesIcon /> },
  { id: "albums",         label: "Albums",                  icon: <AlbumsIcon /> },
  { id: "documents",      label: "Documents",               icon: <DocumentsIcon /> },
  { id: "screenshots",    label: "Screenshots & recordings",icon: <ScreenshotsIcon /> },
  { id: "favorites",      label: "Favorites",               icon: <FavoritesIcon /> },
  { id: "people",         label: "People & pets",           icon: <PeopleIcon /> },
  { id: "places",         label: "Places",                  icon: <PlacesIcon /> },
  { id: "videos",         label: "Videos",                  icon: <VideosIcon /> },
  { id: "recently-added", label: "Recently added",          icon: <RecentIcon /> },
  { id: "shared",         label: "Shared",                  icon: <SharedIcon /> },
  { id: "import",         label: "Add",                     icon: <ImportIcon /> },
  { id: "trash",          label: "Trash",                   icon: <TrashIcon /> },
];

export default function Sidebar({ view, onChangeView }: SidebarProps) {
  return (
    <aside className="w-60 bg-white border-r h-screen sticky top-0 overflow-y-auto flex-shrink-0">
      <div className="p-4">
        <h1 className="text-base font-bold mb-5 px-1">📸 Family Photos</h1>
        <nav className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavItem
              key={item.id}
              label={item.label}
              icon={item.icon}
              active={view === item.id || (item.id === "people" && view === "unidentified")}
              onClick={() => onChangeView(item.id)}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}
