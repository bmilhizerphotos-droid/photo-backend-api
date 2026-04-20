import React from "react";
import { Link } from "react-router-dom";
import { Album } from "../api";

export type AppView =
  | "photos"
  | "search"
  | "on-this-day"
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
  | "map"
  | "places"
  | "videos"
  | "recently-added"
  | "shared"
  | "import"
  | "trash"
  | "duplicates"
  | "status"
  | "admin";

/** Maps every AppView to its canonical URL path */
export const VIEW_PATHS: Partial<Record<AppView, string>> = {
  photos:           "/photos",
  search:           "/search",
  "on-this-day":    "/on-this-day",
  memories:         "/memories",
  albums:           "/albums",
  documents:        "/documents",
  screenshots:      "/screenshots",
  favorites:        "/favorites",
  people:           "/people",
  unidentified:     "/people/unidentified",
  map:              "/map",
  places:           "/places",
  videos:           "/videos",
  "recently-added": "/recently-added",
  shared:           "/shared",
  import:           "/import",
  trash:            "/trash",
  duplicates:       "/duplicates",
  admin:            "/admin",
};

interface NavItemConfig {
  id: AppView;
  label: string;
  icon: string;
  badge?: string;
  badgeAmber?: boolean;
  dividerBefore?: boolean;
}

const NAV_ITEMS: NavItemConfig[] = [
  { id: "photos",          label: "Photos",          icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "on-this-day",     label: "On This Day",     icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "memories",        label: "Memories",        icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "albums",          label: "Albums",           icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
  { id: "favorites",       label: "Favorites",       icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" },
  { id: "people",          label: "People & Pets",   icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "unidentified",    label: "Unidentified",    icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", badgeAmber: true },
  { id: "map",             label: "Map",             icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7", dividerBefore: true },
  { id: "places",          label: "Places",          icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" },
  { id: "videos",          label: "Videos",          icon: "M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" },
  { id: "documents",       label: "Documents",       icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { id: "screenshots",     label: "Screenshots",     icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  { id: "recently-added",  label: "Recently Added",  icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", dividerBefore: true },
  { id: "shared",          label: "Shared",          icon: "M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" },
  { id: "import",          label: "Add Photos",      icon: "M12 4v12m0 0l-4-4m4 4l4-4 M4 20h16" },
  { id: "duplicates",      label: "Duplicates",      icon: "M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" },
  { id: "trash",           label: "Trash",           icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" },
];

const ADMIN_ITEM: NavItemConfig = {
  id: "admin",
  label: "Admin",
  icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  dividerBefore: true,
};

function activeNavId(view: AppView): AppView {
  if (view === "person-detail") return "people";
  if (view === "unidentified")  return "people";
  if (view === "album-detail")  return "albums";
  if (view === "search")        return "photos";
  if (view === "memory-detail") return "memories";
  return view;
}

function SvgIcon({ path, size = 17 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

interface SidebarProps {
  view: AppView;
  onChangeView: (v: AppView) => void;
  albums: Album[];
  selectedAlbumId: number | null;
  onSelectAlbum: (albumId: number) => void;
  onCreateAlbum: () => void;
  isAdmin?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  view,
  onChangeView,
  albums,
  selectedAlbumId,
  onSelectAlbum,
  onCreateAlbum,
  isAdmin,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const active = activeNavId(view);
  const items = [...NAV_ITEMS, ...(isAdmin || (typeof window !== "undefined" && window.location.search.includes("debug=true")) ? [ADMIN_ITEM] : [])];

  return (
    <aside
      style={{
        width: collapsed ? 64 : 232,
        minWidth: collapsed ? 64 : 232,
        transition: "width 0.22s cubic-bezier(0.4,0,0.2,1), min-width 0.22s cubic-bezier(0.4,0,0.2,1)",
      }}
      className="relative h-screen bg-white/65 backdrop-blur-xl border-r border-black/[0.07] flex flex-col overflow-hidden flex-shrink-0 shadow-[2px_0_20px_rgba(0,0,0,0.04)]"
    >
      {/* Logo row */}
      <div
        className="flex items-center border-b border-black/[0.06] flex-shrink-0"
        style={{
          gap: 10,
          padding: collapsed ? "20px 0" : "20px 16px",
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)", boxShadow: "0 2px 12px rgba(99,102,241,0.3)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold text-slate-900 whitespace-nowrap tracking-tight">
            Family Photos
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2" style={{ scrollbarWidth: "none" }}>
        {items.map((item) => {
          const isActive = active === item.id;
          const to = VIEW_PATHS[item.id] ?? "/photos";
          return (
            <React.Fragment key={item.id}>
              {item.dividerBefore && (
                <div className="h-px bg-black/[0.06] mx-3 my-1.5" />
              )}
              <Link
                to={to}
                title={collapsed ? item.label : undefined}
                onClick={() => onChangeView(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: collapsed ? "9px 0" : "9px 12px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  background: isActive ? "rgba(99,102,241,0.08)" : "transparent",
                  color: isActive ? "#6366f1" : "#64748b",
                  position: "relative",
                  textDecoration: "none",
                  transition: "color 0.15s, background 0.15s",
                  borderRadius: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "rgba(0,0,0,0.04)";
                    e.currentTarget.style.color = "#0f172a";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive ? "rgba(99,102,241,0.08)" : "transparent";
                  e.currentTarget.style.color = isActive ? "#6366f1" : "#64748b";
                }}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <div className="absolute left-0 w-[3px] h-5 rounded-r-sm"
                    style={{ background: "#6366f1", top: "50%", transform: "translateY(-50%)" }} />
                )}
                <SvgIcon path={item.icon} size={17} />
                {!collapsed && (
                  <>
                    <span className="text-[13px] flex-1 text-left whitespace-nowrap"
                      style={{ fontWeight: isActive ? 500 : 400 }}>
                      {item.label}
                    </span>
                    {item.badge && (
                      <span className="text-[10px] font-semibold px-1.5 py-px rounded-full"
                        style={{
                          background: item.badgeAmber ? "rgba(245,158,11,0.12)" : "rgba(0,0,0,0.06)",
                          color: item.badgeAmber ? "#d97706" : "#94a3b8",
                        }}>
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </Link>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Albums sub-list (only when expanded) */}
      {!collapsed && albums.length > 0 && (
        <div className="border-t border-black/[0.06] px-3 py-3 flex-shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Albums</span>
            <button onClick={onCreateAlbum} className="text-xs text-indigo-500 hover:text-indigo-700" title="Create album">+</button>
          </div>
          <div className="space-y-px">
            {albums.slice(0, 10).map((album) => (
              <button
                key={album.id}
                onClick={() => onSelectAlbum(album.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors ${
                  selectedAlbumId === album.id
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-slate-500 hover:bg-black/[0.04] hover:text-slate-800"
                }`}
              >
                <span className="text-slate-400 text-[11px]">🖼</span>
                <span className="truncate">{album.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Collapse toggle button — floats on the right edge */}
      <button
        onClick={onToggleCollapse}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{
          position: "absolute",
          top: 22,
          right: -12,
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.9)",
          border: "1px solid rgba(0,0,0,0.1)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94a3b8",
          zIndex: 20,
          backdropFilter: "blur(8px)",
          transition: "all 0.15s",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#0f172a"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d={collapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
        </svg>
      </button>
    </aside>
  );
}
