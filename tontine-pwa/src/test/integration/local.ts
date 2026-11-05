// Outils des tests d'intégration contre Supabase local (jamais un projet distant).
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { supabase } from '@/lib/supabase';

const DB_CONTAINER = 'supabase_db_calebasse';
/** Secret JWT du Supabase local (`npx supabase status`), public et propre au développement. */
const LOCAL_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

if (!import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1')) {
  throw new Error('Les tests d’intégration ne tournent que contre Supabase local.');
}

/** SQL direct (superutilisateur) sur la base locale : préparation et nettoyage. */
export function sql(query: string): string {
  const result = spawnSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA'],
    { input: query, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr || 'psql a échoué');
  return result.stdout.trim();
}

function token(userId: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 3600,
  })}`;
  return `${body}.${createHmac('sha256', LOCAL_JWT_SECRET).update(body).digest('base64url')}`;
}

/**
 * Ouvre la session de ce compte dans le client de l'application (sans SMS ni PIN) : le
 * jeton est rangé là où le client le relit à chaque appel (clé de lib/supabase.ts).
 */
export async function signInAs(userId: string): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  window.localStorage.setItem(
    'calebasse.auth.v1',
    JSON.stringify({
      access_token: token(userId),
      refresh_token: 'integration-test',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user: { id: userId, aud: 'authenticated', role: 'authenticated' },
    }),
  );
  const { data } = await supabase().auth.getSession();
  if (data.session?.user.id !== userId) throw new Error('Session de test non prise en compte');
}

/**
 * Enregistre un code SMS connu pour ce numéro, sans rien envoyer : même empreinte que
 * l'Edge Function auth-otp-send (HMAC avec OTP_PEPPER du fichier local functions/.env).
 */
export function issueOtp(phone: string, code: string): void {
  // Les tests se lancent depuis tontine-pwa/ : le backend est à côté.
  const envFile = readFileSync(
    resolve(process.cwd(), '../backend/supabase/functions/.env'),
    'utf8',
  );
  const pepper = envFile.match(/^OTP_PEPPER=(.*)$/m)?.[1]?.trim();
  if (!pepper) throw new Error('OTP_PEPPER absent de backend/supabase/functions/.env');
  const hash = createHmac('sha256', pepper).update(`${phone}:${code}`).digest('hex');
  sql(`select public.svc_otp_issue('${phone}', '${hash}', null, 10);`);
}
