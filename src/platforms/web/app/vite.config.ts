import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// New React app (sibling to the legacy microact frontend). Talks to the backend /v1 + /api.
export default defineConfig({
  plugins: [react()],
  // snarkjs (in-browser ceremony contribution) reaches for `process.browser` and `global`
  // via fastfile; shim them so the WASM contribution path runs in the bundle.
  define: {
    'process.browser': 'true',
    global: 'globalThis',
  },
  server: {
    port: 5174,
    host: true, // reachable over Tailscale
    proxy: {
      // Point at the live staging cluster — the React app is a real frontend for staging /v1.
      '/v1': { target: process.env.API_ORIGIN || 'https://staging.noema.art', changeOrigin: true, secure: true },
      '/api': { target: process.env.API_ORIGIN || 'https://staging.noema.art', changeOrigin: true, secure: true },
    },
  },
});
