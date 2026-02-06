// FILE: frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Force IPv4 to avoid localhost -> ::1 issues on Windows
const BACKEND = "http://127.0.0.1:3001";

export default defineConfig({
  appType: "spa",
  base: "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: BACKEND,
        changeOrigin: true,
        secure: false,
      },
      "/thumbnails": {
        target: BACKEND,
        changeOrigin: true,
        secure: false,
      },
      "/photos": {
        target: BACKEND,
        changeOrigin: true,
        secure: false,
      },
      "/display": {
        target: BACKEND,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
