export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY,
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  /** Envoi automatique des cagnottes par PayTech (quand il est branché côté serveur). */
  autoPayout: import.meta.env.VITE_AUTO_PAYOUT === 'true',
  /** Connexion par le backend (code SMS réel, PIN vérifié par le serveur). */
  realAuth: import.meta.env.VITE_AUTH_MODE === 'supabase',
} as const;
