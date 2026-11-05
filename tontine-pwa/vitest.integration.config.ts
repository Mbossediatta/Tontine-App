// Tests d'intégration : les vrais services de l'application contre Supabase local
// (prérequis : `npm start` dans backend/). Ils créent leurs propres comptes et effacent
// tout ce qu'ils ont écrit à la fin.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/integration/**/*.test.ts'],
    env: { VITE_AUTH_MODE: 'supabase' },
    // Un seul fichier à la fois : ils partagent la base locale.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
