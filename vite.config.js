import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Use './' so the build works on Vercel, Netlify, and GitHub Pages without changes.
// For GitHub Pages under a sub-path, replace './' with '/your-repo-name/'.
export default defineConfig({
  plugins: [react()],
  base: '/thailand-research-dashboard/',
  server: {
    port: 5173,
    open: true,
  },
})
