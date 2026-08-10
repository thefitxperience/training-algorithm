import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works under any GitHub Pages path
  // (https://<user>.github.io/<repo>/) without hardcoding the repo name.
  // data/*.json is fetched via import.meta.env.BASE_URL, so it follows this.
  base: './',
  plugins: [react(), tailwindcss()],
})
