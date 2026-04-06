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
      '/api/studio': 'http://localhost:3141',
    },
  },
})
