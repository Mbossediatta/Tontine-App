// Appels aux fonctions SQL (RPC) et lectures de tables, avec erreurs affichables.
// Les fonctions du backend lèvent des messages en français prêts à l'écran ; leur code
// SQL indique la nature de l'erreur (voir backend/supabase/migrations/…_groupes.sql).
import { FunctionsHttpError } from '@supabase/supabase-js';
import { ServiceError, type ServiceErrorCode } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { ListPage, PageCursor } from '@/types';

export interface DbError {
  code?: string;
  message: string;
  hint?: string | null;
}

const CODES: Record<string, ServiceErrorCode> = {
  '42501': 'forbidden',
  '22023': 'invalid',
  '23505': 'conflict',
  P0002: 'not_found',
  '28000': 'unauthenticated',
};

export function requireOnline(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ServiceError('Connexion requise pour cette action.', 'offline');
  }
}

/** Erreur de la base → ServiceError ; les refus signalés par un indice sont tracés. */
export function toServiceError(error: DbError, fallback: string): ServiceError {
  const hint = error.hint ?? '';
  if (hint.startsWith('suspicious_input:') || hint.startsWith('access_denied:')) {
    // Le refus a annulé toute écriture côté serveur : on le trace après coup.
    void supabase()
      .rpc('log_refusal', { p_hint: hint })
      .then(
        () => undefined,
        () => undefined,
      );
  }
  if (error.code === 'PGRST301' || error.code === '28000') {
    return new ServiceError('Session expirée, reconnectez-vous.', 'unauthenticated');
  }
  const code = error.code ? CODES[error.code] : undefined;
  return code ? new ServiceError(error.message, code) : new ServiceError(fallback);
}

/** Appelle une fonction SQL ; renvoie son résultat ou lève une ServiceError. */
export async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {},
  fallback = 'Action impossible pour le moment. Vérifiez la connexion et réessayez.',
): Promise<T> {
  const { data, error } = await supabase().rpc(name, args);
  if (error) throw toServiceError(error, fallback);
  return data as T;
}

/** Résultat d'une lecture de table : les lignes, ou une ServiceError. */
export function rows<T>(
  result: { data: unknown; error: DbError | null },
  fallback = 'Impossible de charger les données. Réessayez.',
): T[] {
  if (result.error) throw toServiceError(result.error, fallback);
  return (result.data ?? []) as T[];
}

/** Identifiant du compte connecté (session Supabase). */
export async function sessionUserId(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new ServiceError('Session expirée, reconnectez-vous.', 'unauthenticated');
  return id;
}

const FUNCTION_CODES: ServiceErrorCode[] = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'invalid',
  'conflict',
];

/** Appelle une Edge Function ; ses erreurs { error: { code, message } } deviennent des ServiceError. */
export async function invoke<T>(
  name: string,
  body: Record<string, unknown>,
  fallback = 'Action impossible pour le moment. Vérifiez la connexion et réessayez.',
): Promise<T> {
  requireOnline();
  const { data, error } = await supabase().functions.invoke(name, { body });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    const payload = await (error.context as Response).json().catch(() => null);
    const code = payload?.error?.code;
    if (typeof payload?.error?.message === 'string') {
      throw new ServiceError(
        payload.error.message,
        FUNCTION_CODES.includes(code) ? code : 'invalid',
      );
    }
  }
  throw new ServiceError(fallback);
}

/** Page renvoyée par les fonctions SQL *_page (voir migration …_pagination_listes.sql). */
export interface ServerPage<Row, Summary> {
  rows: Row[];
  hasMore: boolean;
  summary: Summary | null;
}

/** Page du serveur → ListPage : lignes converties, curseur de la suivante, totaux. */
export function fromServerPage<Row, View, Summary>(
  page: ServerPage<Row, Summary>,
  toView: (row: Row) => View,
  cursorOf: (row: Row) => PageCursor,
): ListPage<View, Summary> {
  const last = page.rows[page.rows.length - 1];
  return {
    rows: page.rows.map(toView),
    next: page.hasMore && last ? cursorOf(last) : undefined,
    summary: page.summary ?? undefined,
  };
}
