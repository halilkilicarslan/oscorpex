import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Prevent proxy stream errors from crashing the dev server.
process.on('uncaughtException', (err) => {
  console.warn('[vite] uncaught exception (ignored in dev):', err.message)
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_PROXY_TARGET || 'http://localhost:3141'
  console.log(`[vite] proxy target: ${target}`)

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@oscorpex/control-plane': '/Users/iamhk/development/personal/oscorpex/packages/control-plane/src/index.ts',
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-recharts': ['recharts'],
          },
        },
      },
    },
    server: {
      port: 5161,
      proxy: {
        '/api/studio': {
          target,
          changeOrigin: true,
          configure: (proxy) => {
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
        '/api/observability': {
          target,
          changeOrigin: true,
        },
        '/api/auth': {
          target,
          changeOrigin: true,
        },
      },
    },
  }
})
