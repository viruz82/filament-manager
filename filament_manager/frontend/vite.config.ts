import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Libraries every page needs go into one vendor chunk that stays cached across
// app updates; heavy, page-specific ones (recharts, niimbluelib, qrcode) stay
// with the lazily loaded chunk that imports them.
const VENDOR = /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run|@tanstack|i18next|react-i18next|i18next-browser-languagedetector|lucide-react)[\\/]/
// Small helpers used by several pages: one chunk instead of a dozen tiny files.
// The label helpers stay out, otherwise their static imports (qrcode,
// niimbluelib) would be pulled into the start bundle.
const SHARED = /[\\/]src[\\/](utils|hooks|components[\\/]ui)[\\/]/
const LABEL_ONLY = /[\\/]src[\\/]utils[\\/](labelRender|niimbot)\.ts$/

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (VENDOR.test(id)) return 'vendor'
          if (SHARED.test(id) && !LABEL_ONLY.test(id)) return 'shared'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8099',
    },
  },
})
