import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { devApiPlugin } from './scripts/dev-api.js'
import fs from 'fs'
// Read package.json version for build injection
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Auto-follow redirects in proxy to avoid CORS from backend 301/302
function configureProxyFollowRedirects(proxy) {
  proxy.on('proxyRes', (proxyRes, req, res) => {
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
      const location = proxyRes.headers.location
      if (location && location.startsWith('http')) {
        try {
          const urlObj = new URL(location)
          // Rewrite absolute URL to relative path so browser stays on proxy
          proxyRes.headers.location = urlObj.pathname + urlObj.search
        } catch { /* ignore */ }
      }
    }
  })
}

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-virtual',
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: false,
    proxy: {
      '/api/langgraph': {
        target: process.env.DEERFLOW_GATEWAY_URL || 'http://localhost:8012',
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
      },
      '/api': {
        target: process.env.DEERFLOW_GATEWAY_URL || 'http://localhost:8012',
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
        configure: configureProxyFollowRedirects,
      },
    },
    warmup: {
      clientFiles: ['./src/react/ChatApp.tsx'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
