import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
        // SSE akışlarının bufferlenmesini önle
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
})
