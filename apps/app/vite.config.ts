import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri si aspetta una porta fissa in sviluppo e file relativi nella build.
export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', outDir: 'dist' },
});
