import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { devApiPlugin } from './scripts/dev-api.js'
import fs from 'fs'
// Read package.json version for build injection
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const gatewayProxyTarget = process.env.DEERFLOW_GATEWAY_URL || 'http://localhost:8012'

// Auto-follow redirects in proxy to avoid CORS from backend 301/302; surface clear errors when Gateway is down
function configureGatewayProxy(proxy) {
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
  proxy.on('error', (err, req, res) => {
    const code = err && (err.code || err.message || String(err))
    console.error(`[vite] /api proxy → ${gatewayProxyTarget} failed:`, code)
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      const detail =
        `DeerFlow Gateway not reachable at ${gatewayProxyTarget} (${code}). ` +
        'Start LangGraph (2024) + Gateway (8012), e.g. scripts/windows/start-backend.ps1, ' +
        'or set DEERFLOW_GATEWAY_URL if your Gateway uses another port (e.g. 8001 with make gateway).'
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ detail }))
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
        target: gatewayProxyTarget,
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
        configure: configureGatewayProxy,
      },
      '/api': {
        target: gatewayProxyTarget,
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
        configure: configureGatewayProxy,
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
