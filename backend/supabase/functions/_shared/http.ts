// Réponses HTTP, erreurs et CORS communs à toutes les Edge Functions.
// Le frontend convertit { error: { code, message } } en ServiceError (src/lib/errors.ts).

export type ErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'conflict';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
};

/** Erreur métier : son message, en français, est affiché tel quel à l'utilisateur. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode = 'invalid',
    readonly status: number = STATUS[code],
  ) {
    super(message);
  }
}

export const TOO_MANY = (message = 'Trop de tentatives. Réessayez dans une heure.') =>
  new AppError(message, 'forbidden', 429);

function allowedOrigins(): string[] {
  const list = Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('APP_URL') ?? '';
  return list.split(',').map((item) => item.trim()).filter(Boolean);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (allowedOrigins().includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Adresse IP du client (au mieux : derrière le proxy de Supabase). */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = req.headers.get('cf-connecting-ip') ?? forwarded ?? null;
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

/** Corps JSON de la requête, ou erreur « invalid ». */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // corps absent ou mal formé
  }
  throw new AppError('Requête invalide.');
}

export function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') throw new AppError('Requête invalide.');
  return value.trim();
}

/** Numéro sénégalais à 9 chiffres (format du frontend). */
export function phoneField(body: Record<string, unknown>, key = 'phone'): string {
  const phone = stringField(body, key).replace(/\s/g, '');
  if (!/^7[0-9]{8}$/.test(phone)) throw new AppError('Numéro de téléphone invalide.');
  return phone;
}

/**
 * Point d'entrée commun : CORS, méthode POST seulement, conversion des erreurs.
 * Aucune donnée sensible (code, PIN, jeton) n'est jamais écrite dans les journaux.
 */
export function serve(handler: (req: Request) => Promise<unknown>): void {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
    if (req.method !== 'POST') return json(req, { error: { code: 'invalid', message: 'Méthode non autorisée.' } }, 405);
    try {
      return json(req, (await handler(req)) ?? { ok: true });
    } catch (error) {
      if (error instanceof AppError) {
        return json(req, { error: { code: error.code, message: error.message } }, error.status);
      }
      console.error('Erreur interne', error instanceof Error ? error.message : 'inconnue');
      return json(
        req,
        { error: { code: 'invalid', message: 'Une erreur est survenue. Réessayez dans un instant.' } },
        500,
      );
    }
  });
}
