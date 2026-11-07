/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_VAPID_PUBLIC_KEY: string;
  readonly VITE_USE_MOCKS: string;
  readonly VITE_AUTO_PAYOUT?: string;
  /** « supabase » : connexion réelle par le backend ; sinon simulée. */
  readonly VITE_AUTH_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
