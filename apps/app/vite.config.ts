import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri si aspetta una porta fissa in sviluppo e file relativi nella build.
export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022', outDir: 'dist',
    rollupOptions: {
      output: {
        // Librerie in pezzi separati: cambiano di rado, restano in cache tra un aggiornamento e l'altro.
        manualChunks: (id) => {
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('@phosphor-icons')) return 'icone';
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('menu-moorea.json')) return 'menu-demo';
        },
      },
    },
  },
});
