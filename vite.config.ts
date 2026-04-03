import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      manifest: {
        name: 'VocalSync Studio',
        short_name: 'VocalSync',
        description: 'Профессиональная студия для записи вокала в браузере',
        theme_color: '#1A1A2E',
        background_color: '#0F0F1B',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'https://cdn-icons-png.flaticon.com/512/3663/3663345.png', // Временная иконка
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'https://cdn-icons-png.flaticon.com/512/3663/3663345.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
  build: {
    target: 'esnext' // Для поддержки Workers
  }
})