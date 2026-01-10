import React from "react";

export type AppView =
  | "photos"
  | "favorites"
  | "people"
  | "memories"
  | "import"
  | "trash"
  | "albums";

export default function Sidebar(props: {
  view: AppView;
  onChangeView: (v: AppView) => void;
}) {
  const { view, onChangeView } = props;

  const Item = (p: { id: AppView; label: string }) => {
    const active = view === p.id;
    return (
      <button
        onClick={() => onChangeView(p.id)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid transparent",
          background: active ? "rgba(37, 99, 235, 0.10)" : "transparent",
          color: active ? "#1d4ed8" : "#0f172a",
          fontWeight: active ? 800 : 600,
          cursor: "pointer",
        }}
        aria-current={active ? "page" : undefined}
      >
        {p.label}
      </button>
    );
  };

  return (
    <aside
      style={{
        width: 260,
        flex: "0 0 260px",
        borderRight: "1px solid #e5e7eb",
        background: "white",
        padding: 16,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        height: "100vh",
        overflowY: "auto",
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 14, color: "#0f172a" }}>
        Library
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Item id="photos" label="Photos" />
        <Item id="favorites" label="Favorites" />
        <Item id="people" label="People" />
        <Item id="memories" label="Memories" />
        <Item id="import" label="Import" />
        <Item id="trash" label="Trash" />
      </div>

      <div style={{ height: 18 }} />

      <div style={{ fontWeight: 900, marginBottom: 10, color: "#0f172a" }}>
        Albums
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Item id="albums" label="All Albums" />
        <div style={{ padding: "6px 12px", color: "#64748b", fontSize: 13 }}>
          Custom albums will appear here (per-user) in the next step.
        </div>
      </div>
    </aside>
  );
}
