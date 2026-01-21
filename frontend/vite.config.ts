// FILE: frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND = "http://localhost:3001";

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
