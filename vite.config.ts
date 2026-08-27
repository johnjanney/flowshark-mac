import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Tauri expects a fixed dev port and a predictable dist directory.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // WKWebView on macOS 14+ supports modern syntax.
    target: 'safari17',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
