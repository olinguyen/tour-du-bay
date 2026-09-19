import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

// Added at build time only: the dev server injects an inline react-refresh preamble that a script-src 'self' policy
// would block. Leaflet and React set inline styles; terrain tiles come from the DEM host; the CSS has a data: SVG grain.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://s3.amazonaws.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const csp = (): PluginOption => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  // Relative, so the built asset URLs resolve against whatever path the page is
  // served from. GitHub Pages puts this project site under /tour-du-bay/, but
  // the same build also works from a domain root. (Vite treats a relative base
  // as "/" for the dev server.)
  base: './',
  plugins: [react(), csp()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // The routes are a third of the page's JavaScript and change only when a ride is replanned, so they get
        // their own chunk: the browser fetches it alongside the app chunk (Vite preloads it from index.html)
        // rather than after it, and an edit to the app leaves the cached copy alone.
        manualChunks: id => (/src[\\/]data[\\/]routes\.generated\./.test(id) ? 'routes' : undefined),
      },
    },
  },
});
