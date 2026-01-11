import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
      "/thumbnails": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
      // If your backend uses /api/thumbnails instead:
      // "/api/thumbnails": { target: "http://127.0.0.1:3001", changeOrigin: true }
    },
  },
});
