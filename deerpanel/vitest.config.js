import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    // 其余 tests/*.test.js 使用 node:test，由 `node --test` 单独运行
    include: ['tests/chat-normalize.test.js', 'tests/tool-display.test.js'],
  },
})
