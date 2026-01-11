import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      'process.env.VITE_API_BASE': JSON.stringify(env.VITE_API_BASE),
    },
    server: {
      hmr: true,
      // Force cache busting
      fs: {
        strict: false
      },
      // Fix Firebase popup authentication issues
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
        // Removed COEP to allow Firebase popups to work
      }
    },
    // Force rebuild on change
    optimizeDeps: {
      force: true
    }
  }
})
