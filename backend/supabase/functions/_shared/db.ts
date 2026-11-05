// Accès à la base depuis les Edge Functions (clé service_role, jamais envoyée au navigateur).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { AppError, clientIp, type ErrorCode } from './http.ts';
import { internalPassword, requireEnv, technicalEmail } from './crypto.ts';

let adminClient: SupabaseClient | null = null;

/** Client service_role : contourne RLS, à n'utiliser qu'après les vérifications. */
export function admin(): SupabaseClient {
  adminClient ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

/** Erreur de la base → erreur interne (le détail ne part jamais au navigateur). */
export function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  avatar_url: string | null;
  global_role: 'super_admin' | 'admin' | 'user';
  is_suspended: boolean;
  payout_phone: string | null;
  payout_method: 'wave' | 'orange_money' | null;
  language: 'fr' | 'wo';
  deleted_at: string | null;
  created_at: string;
}

/** Profil au format du frontend (type User de src/types/index.ts). */
export function toUser(profile: Profile) {
  return {
    id: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    phone: profile.phone ?? '',
    avatarUrl: profile.avatar_url ?? undefined,
    globalRole: profile.global_role,
    isSuspended: profile.is_suspended,
    payoutPhone: profile.payout_phone ?? undefined,
    payoutMethod: profile.payout_method ?? undefined,
    deletedAt: profile.deleted_at ?? undefined,
    createdAt: profile.created_at,
    language: profile.language,
  };
}

/** Compte actif lié au numéro ; un compte suspendu est refusé. */
export async function profileByPhone(phone: string): Promise<Profile | null> {
  const profile = check(
    await admin().from('profiles').select('*').eq('phone', phone).is('deleted_at', null).maybeSingle(),
  ) as Profile | null;
  if (profile?.is_suspended) {
    throw new AppError('Ce compte est bloqué. Contactez un administrateur.', 'forbidden');
  }
  return profile;
}

/** Personne connectée (jeton Supabase de l'en-tête Authorization), active. */
export async function caller(req: Request): Promise<Profile> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data } = await admin().auth.getUser(token);
  const expired = new AppError('Session expirée, reconnectez-vous.', 'unauthenticated');
  if (!data.user) throw expired;
  const profile = check(
    await admin().from('profiles').select('*').eq('id', data.user.id).maybeSingle(),
  ) as Profile | null;
  if (!profile || profile.deleted_at) throw expired;
  if (profile.is_suspended) {
    throw new AppError('Ce compte est bloqué. Contactez un administrateur.', 'forbidden');
  }
  return profile;
}

export interface SecuritySettings {
  otpValidityMinutes: number;
  maxPinAttempts: number;
  inactivityLockMinutes: number;
}

export async function securitySettings(): Promise<SecuritySettings> {
  const row = check(await admin().from('platform_settings').select('security').single()) as {
    security: SecuritySettings;
  };
  return row.security;
}

export async function recordSecurityEvent(event: {
  kind: 'pin_failed' | 'pin_blocked' | 'otp_failed' | 'access_denied' | 'suspicious_input' | 'admin_login';
  severity: 'info' | 'warning' | 'critical';
  detail: string;
  userId?: string;
  phone?: string;
  ip?: string | null;
}): Promise<void> {
  check(
    await admin().from('security_events').insert({
      kind: event.kind,
      severity: event.severity,
      detail: event.detail,
      user_id: event.userId ?? null,
      phone: event.phone ?? null,
      ip: event.ip ?? null,
    }),
  );
}

export async function recordAudit(entry: {
  actorId: string;
  action: string;
  summary: string;
  groupId?: string;
}): Promise<void> {
  check(
    await admin().from('audit_log').insert({
      actor_id: entry.actorId,
      action: entry.action,
      summary: entry.summary,
      group_id: entry.groupId ?? null,
    }),
  );
}

/**
 * Ouvre la session Supabase après un PIN correct, avec le mot de passe interne.
 * Renvoie les jetons (le frontend les passe à supabase.auth.setSession) et le profil.
 */
export async function openSession(profile: Profile, ip: string | null) {
  const client = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const credentials = { email: technicalEmail(profile.id), password: await internalPassword(profile.id) };
  let { data, error } = await client.auth.signInWithPassword(credentials);
  if (error?.status === 400) {
    // Compte du seed, ou poivre SESSION_PEPPER changé : le PIN vient d'être vérifié,
    // on réaligne le mot de passe interne puis on réessaie une fois.
    const reset = await admin().auth.admin.updateUserById(profile.id, credentials);
    if (reset.error) throw new Error(`Mot de passe interne : ${reset.error.message}`);
    ({ data, error } = await client.auth.signInWithPassword(credentials));
  }
  if (error || !data.session) throw new Error(`Ouverture de session impossible : ${error?.message ?? ''}`);
  if (profile.global_role !== 'user') {
    await recordAudit({ actorId: profile.id, action: 'login', summary: 's’est connecté' });
    await recordSecurityEvent({
      kind: 'admin_login', severity: 'info', detail: 'Connexion d’un administrateur', userId: profile.id, ip,
    });
  }
  return {
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
    },
    user: toUser(profile),
  };
}

/** Crée le compte Supabase Auth (e-mail technique, mot de passe interne) d'un profil. */
export async function createAuthUser(): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await admin().auth.admin.createUser({
    id,
    email: technicalEmail(id),
    password: await internalPassword(id),
    email_confirm: true,
  });
  if (error) throw new Error(`Création du compte impossible : ${error.message}`);
  return id;
}

/** Super admin connecté ; sinon refus noté au journal de sécurité. */
export async function superAdminCaller(req: Request, refusal: string): Promise<Profile> {
  const actor = await caller(req);
  if (actor.global_role !== 'super_admin') {
    await recordSecurityEvent({
      kind: 'access_denied',
      severity: 'warning',
      detail: refusal,
      userId: actor.id,
      ip: clientIp(req),
    });
    throw new AppError('Action réservée au super administrateur.', 'forbidden');
  }
  return actor;
}

const DB_CODES: Record<string, ErrorCode> = {
  '22023': 'invalid',
  '23505': 'conflict',
  '42501': 'forbidden',
  P0002: 'not_found',
};

/**
 * Résultat d'une fonction SQL dont les erreurs métier ont un message affichable
 * (codes 22023, 23505, 42501, P0002) : elles deviennent des AppError ; les autres restent
 * des erreurs internes.
 */
export function checkBusiness<T>(result: {
  data: T;
  error: { code?: string; message: string } | null;
}): T {
  const code = result.error?.code ? DB_CODES[result.error.code] : undefined;
  if (result.error && code) throw new AppError(result.error.message, code);
  return check(result);
}
