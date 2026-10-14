import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

// The UI. npm start runs it inside the local server (server/index.js), which also answers /api calls.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.join(root, 'src') },
  },
});
