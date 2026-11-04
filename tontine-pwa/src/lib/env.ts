export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY,
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
} as const;
