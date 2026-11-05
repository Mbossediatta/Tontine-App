// Client Supabase unique de l'application (cahier d'intégration, section 2.1).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont requis');
  }
  client ??= createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'calebasse.auth.v1' },
  });
  return client;
}
