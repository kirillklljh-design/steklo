import { defineConfig, loadEnv } from 'vite';
import { publicSupabaseConfig } from './src/public-config.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    base: '/',
    publicDir: false,
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || publicSupabaseConfig.url),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY || publicSupabaseConfig.publishableKey),
    },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
