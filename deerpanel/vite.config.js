import { defineConfig } from 'vite'
import { devApiPlugin } from './scripts/dev-api.js'
import fs from 'fs'
import path from 'path'
import { homedir } from 'os'

// 读取 package.json 版本号，构建时注入前�?const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// 读取 Gateway 端口（启动时读取一次）
// 注意：Gateway 默认端口�?18789，不�?18790
let gatewayPort = 18789
try {
  const cfgPath = path.join(homedir(), '.deerpanel', 'deerpanel.json')
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    // 端口必须 > 0 �?< 65536
    const port = cfg?.gateway?.port
    if (port && typeof port === 'number' && port > 0 && port < 65536) {
      gatewayPort = port
    }
  }
} catch (e) {
  console.warn('[vite] 读取 Gateway 端口配置失败，使用默认端�?18789:', e.message)
}

console.log(`[vite] Gateway WebSocket 代理目标: ws://127.0.0.1:${gatewayPort}`)

export default defineConfig({
  plugins: [devApiPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/ws': {
        target: `ws://127.0.0.1:${gatewayPort}`,
        ws: true,
        changeOrigin: true,
        timeout: 30000,
        configure: (proxy, options) => {
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            socket.setTimeout(30000)
            socket.on('timeout', () => {
              console.warn('[vite/ws] WebSocket 超时，关闭连�?)
              socket.destroy()
            })
          })
          proxy.on('error', (err, req, socket) => {
            console.warn(`[vite/ws] 代理错误: ${err.code} ${err.message}`)
            // WebSocket 升级�?socket �?net.Socket，无 headersSent
            if (socket && !socket.destroyed) {
              socket.destroy()
            }
          })
        },
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
