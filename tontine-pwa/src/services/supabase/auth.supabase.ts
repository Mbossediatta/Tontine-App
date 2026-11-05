// Connexion réelle : code SMS (Orange) et PIN vérifiés par les Edge Functions du backend
// (backend/README.md, « Connexion »). La session Supabase ne s'ouvre qu'après le PIN.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { ServiceError, type ServiceErrorCode } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { LegalTerms, TermsStatus, User } from '@/types';
import type { AuthService, OtpResult } from '../auth.service';
import { rpc } from './rpc';

/**
 * Lien avec les données encore simulées : tant que les autres services ne sont pas
 * branchés, le compte réel est rattaché à un compte de la simulation.
 */
export interface SessionBridge {
  link(user: User): User;
  update(user: User): User;
  unlink(): void;
}

const DEFAULT_LOCK_MINUTES = 15;
const PROOF_KEY = 'calebasse.authProof.v1';

/** Numéro prouvé par SMS : jeton de preuve (10 min) gardé pour le profil et le PIN. */
interface Proof {
  phone: string;
  token: string;
  isNewAccount: boolean;
}

function readProof(): Proof | null {
  try {
    const raw = window.sessionStorage.getItem(PROOF_KEY);
    return raw ? (JSON.parse(raw) as Proof) : null;
  } catch {
    return null;
  }
}

function writeProof(proof: Proof | null): void {
  try {
    if (proof) window.sessionStorage.setItem(PROOF_KEY, JSON.stringify(proof));
    else window.sessionStorage.removeItem(PROOF_KEY);
  } catch {
    // Stockage indisponible : il faudra refaire la vérification par SMS.
  }
}

function requireOnline(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ServiceError('Connexion requise pour cette action.', 'offline');
  }
}

const CODES: ServiceErrorCode[] = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'invalid',
  'conflict',
];

/** Appelle une Edge Function ; ses erreurs deviennent des ServiceError (message affichable). */
async function call<T>(name: string, body: Record<string, unknown>): Promise<T> {
  requireOnline();
  const { data, error } = await supabase().functions.invoke(name, { body });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    const payload = await (error.context as Response).json().catch(() => null);
    const code = payload?.error?.code;
    if (typeof payload?.error?.message === 'string') {
      throw new ServiceError(payload.error.message, CODES.includes(code) ? code : 'invalid');
    }
  }
  throw new ServiceError('Service indisponible. Vérifiez votre connexion et réessayez.');
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  avatar_url: string | null;
  global_role: User['globalRole'];
  is_suspended: boolean;
  payout_phone: string | null;
  payout_method: User['payoutMethod'] | null;
  deleted_at: string | null;
  created_at: string;
}

function toUser(row: ProfileRow): User {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone ?? '',
    avatarUrl: row.avatar_url ?? undefined,
    globalRole: row.global_role,
    isSuspended: row.is_suspended,
    payoutPhone: row.payout_phone ?? undefined,
    payoutMethod: row.payout_method ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
  };
}

const PROFILE_COLUMNS =
  'id, first_name, last_name, phone, avatar_url, global_role, is_suspended, payout_phone, payout_method, deleted_at, created_at';

async function ownProfile(userId: string): Promise<User | null> {
  const { data } = await supabase()
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  return data ? toUser(data as ProfileRow) : null;
}

interface SessionReply {
  session: { access_token: string; refresh_token: string };
  user: User;
}

export function createSupabaseAuthService(bridge: SessionBridge): AuthService {
  /** Enregistre la session renvoyée après un PIN correct. */
  async function startSession(reply: SessionReply): Promise<User> {
    const { error } = await supabase().auth.setSession(reply.session);
    if (error)
      throw new ServiceError('Session expirée, recommencez la connexion.', 'unauthenticated');
    writeProof(null);
    const user = (await ownProfile(reply.user.id)) ?? reply.user;
    return bridge.link(user);
  }

  async function sessionUserId(): Promise<string> {
    const { data } = await supabase().auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new ServiceError('Session expirée, reconnectez-vous.', 'unauthenticated');
    return id;
  }

  return {
    async getSession() {
      const { data } = await supabase().auth.getSession();
      const { data: settings } = await supabase().rpc('public_settings');
      const lockAfterMinutes =
        (settings as { security?: { inactivityLockMinutes?: number } } | null)?.security
          ?.inactivityLockMinutes ?? DEFAULT_LOCK_MINUTES;
      const userId = data.session?.user.id;
      const user = userId ? await ownProfile(userId) : null;
      if (user && !user.isSuspended && !user.deletedAt) {
        return { user: bridge.link(user), needsProfile: false, needsPin: false, lockAfterMinutes };
      }
      if (data.session) await supabase().auth.signOut({ scope: 'local' });
      const proof = readProof();
      return {
        user: null,
        needsProfile: proof?.isNewAccount ?? false,
        needsPin: false,
        lockAfterMinutes,
      };
    },

    async loginMethod(phone) {
      const reply = await call<{ method: 'pin' | 'otp' }>('auth-login-method', { phone });
      return reply.method;
    },

    async sendOtp(phone, inviteCode) {
      await call('auth-otp-send', inviteCode ? { phone, inviteCode } : { phone });
    },

    async verifyOtp(phone, code): Promise<OtpResult> {
      const reply = await call<OtpResult & { proofToken: string }>('auth-otp-verify', {
        phone,
        code,
      });
      writeProof({ phone, token: reply.proofToken, isNewAccount: reply.isNewAccount });
      return {
        isNewAccount: reply.isNewAccount,
        firstName: reply.firstName,
        hasPin: reply.hasPin,
        termsVersion: reply.termsVersion,
      };
    },

    async completeProfile(input) {
      const proof = readProof();
      if (!proof)
        throw new ServiceError('Session expirée, recommencez la connexion.', 'unauthenticated');
      await call('auth-profile-create', {
        proofToken: proof.token,
        firstName: input.firstName,
        lastName: input.lastName,
      });
      writeProof({ ...proof, isNewAccount: false });
    },

    async setPin(pin, acceptedTermsVersion) {
      const proof = readProof();
      const reply = await call<SessionReply>('auth-pin-set', {
        pin,
        ...(proof ? { proofToken: proof.token } : {}),
        ...(acceptedTermsVersion === undefined ? {} : { acceptedTermsVersion }),
      });
      return startSession(reply);
    },

    legalTerms() {
      return rpc<LegalTerms>('legal_terms');
    },

    termsStatus() {
      return rpc<TermsStatus>('terms_status');
    },

    async acceptTerms(version) {
      requireOnline();
      await rpc('terms_accept', { p_version: version, p_user_agent: navigator.userAgent });
    },

    async loginWithPin(phone, pin) {
      return startSession(await call<SessionReply>('auth-pin-login', { phone, pin }));
    },

    async changePin(currentPin, newPin) {
      await call('auth-pin-change', { currentPin, newPin });
    },

    async updateProfile(input) {
      requireOnline();
      const userId = await sessionUserId();
      const changes: Record<string, unknown> = {};
      if (input.firstName !== undefined) changes.first_name = input.firstName.trim();
      if (input.lastName !== undefined) changes.last_name = input.lastName.trim();
      if ('avatarUrl' in input) changes.avatar_url = input.avatarUrl ?? null;
      if (input.payoutPhone !== undefined) changes.payout_phone = input.payoutPhone;
      if (input.payoutMethod !== undefined) changes.payout_method = input.payoutMethod;
      const { data, error } = await supabase()
        .from('profiles')
        .update(changes)
        .eq('id', userId)
        .select(PROFILE_COLUMNS)
        .single();
      if (error || !data)
        throw new ServiceError('Modification impossible. Vérifiez les informations saisies.');
      return bridge.update(toUser(data as ProfileRow));
    },

    async logout() {
      writeProof(null);
      bridge.unlink();
      await supabase()
        .auth.signOut({ scope: 'local' })
        .catch(() => undefined);
    },

    async deleteAccount() {
      throw new ServiceError(
        'La suppression du compte sera disponible avec la prochaine étape du serveur.',
        'conflict',
      );
    },
  };
}
