import path from 'path'

import { defineConfig } from 'vite'
import { string } from 'rollup-plugin-string'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    string({
      include: 'src/*.ly',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      external: /^\/vendor\//,
    },
    // emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': 'http://localhost:27252',
    },
  },
})
