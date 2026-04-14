import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Prevent proxy stream errors from crashing the dev server.
// Multiple errors can fire in rapid succession (Parse Error → STREAM_WRITE_AFTER_END)
// so we guard all uncaught exceptions in dev mode.
process.on('uncaughtException', (err) => {
  console.warn('[vite] uncaught exception (ignored in dev):', err.message)
})

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/agents': 'http://localhost:3141',
      '/workflows': 'http://localhost:3141',
      '/tools': 'http://localhost:3141',
      '/doc': 'http://localhost:3141',
      '/api/studio': {
        target: 'http://localhost:3141',
        changeOrigin: true,
        configure: (proxy) => {
          // Prevent uncaught proxy errors from crashing Vite
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
          proxy.on('error', (_err, _req, res) => {
            try { if ('writeHead' in res) (res as any).writeHead(502); (res as any).end(); } catch { /* noop */ }
          });
        },
      },
    },
  },
})
