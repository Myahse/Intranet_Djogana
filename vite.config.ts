import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/files': { target: 'http://localhost:3000', changeOrigin: true },
      '/download/intranet-auth.apk': {
        target: 'https://pub-e7b94b0e8bb94a6e8eca053bb9811f10.r2.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/download/, ''),
      },
    },
  },
})
