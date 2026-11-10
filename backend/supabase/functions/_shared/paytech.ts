// PayTech : demande de paiement et vérification des notifications (IPN).
// Documentation : docs.intech.sn/doc_paytech.php (éditeur de PayTech). Section 4.7 du cahier.
import { hmacHex, safeEqual, sha256Hex } from './crypto.ts';
import { admin, check } from './db.ts';
import { AppError } from './http.ts';
import { isLocal } from './orange-sms.ts';

const API = 'https://paytech.sn/api';

/** Moyens de paiement du frontend → valeurs `target_payment` de PayTech. */
export const TARGET_PAYMENT = {
  wave: 'Wave',
  orange_money: 'Orange Money',
  free_money: 'Free Money',
} as const;

/** `payment_method` renvoyé par PayTech → moyen du frontend (inconnu : null). */
export function methodFromPayTech(label: string | null | undefined) {
  const value = (label ?? '').toLowerCase();
  if (value.includes('wave')) return 'wave' as const;
  if (value.includes('orange')) return 'orange_money' as const;
  if (value.includes('free')) return 'free_money' as const;
  return null;
}

interface Keys {
  apiKey: string;
  apiSecret: string;
}

/**
 * Clés PayTech : secrets du serveur (PAYTECH_API_KEY / PAYTECH_API_SECRET) s'ils sont
 * définis, sinon celles saisies par le super admin dans Paramètres (clé API dans les
 * paramètres, clé secrète dans le coffre-fort). Absentes tant que le compte n'est pas ouvert.
 */
export async function payTechKeys(): Promise<Keys | null> {
  const envKey = Deno.env.get('PAYTECH_API_KEY')?.trim() ?? '';
  const envSecret = Deno.env.get('PAYTECH_API_SECRET')?.trim() ?? '';
  if (envKey && envSecret) return { apiKey: envKey, apiSecret: envSecret };
  const stored = check(await admin().rpc('svc_paytech_keys')) as {
    apiKey: string | null;
    apiSecret: string | null;
  } | null;
  return stored?.apiKey && stored.apiSecret
    ? { apiKey: stored.apiKey, apiSecret: stored.apiSecret }
    : null;
}

/**
 * Clés PayTech d'une organisation (son propre compte marchand : l'argent de ses militants
 * ne passe jamais par le compte de Calebasse) : PAYTECH_API_KEY_<SIGLE> et
 * PAYTECH_API_SECRET_<SIGLE>, ex. PAYTECH_API_KEY_AFP. Absentes : paiement en ligne fermé
 * (simulation en local).
 */
export function orgPayTechKeys(shortName: string): Keys | null {
  const suffix = shortName.toUpperCase();
  const apiKey = Deno.env.get(`PAYTECH_API_KEY_${suffix}`)?.trim() ?? '';
  const apiSecret = Deno.env.get(`PAYTECH_API_SECRET_${suffix}`)?.trim() ?? '';
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

/**
 * Sans clés, en local seulement : le paiement passe par la page simulée de l'appli
 * (payments-simulate), pour tester tout le circuit avant l'ouverture du compte PayTech.
 */
export async function simulationAllowed(): Promise<boolean> {
  return isLocal() && (await payTechKeys()) === null;
}

/**
 * Environnement PayTech : « prod » seulement si le paramètre de la plateforme (super admin)
 * ET le secret PAYTECH_ENV le demandent ; sinon « test » (débit de 100 à 150 FCFA).
 */
export function payTechEnv(settingsMode: string | null | undefined): 'test' | 'prod' {
  return settingsMode === 'prod' && Deno.env.get('PAYTECH_ENV') === 'prod' ? 'prod' : 'test';
}

export interface PaymentRequest {
  itemName: string;
  itemPrice: number;
  refCommand: string;
  commandName: string;
  env: 'test' | 'prod';
  ipnUrl: string;
  successUrl: string;
  cancelUrl: string;
  customField: Record<string, string>;
  targetPayment: string;
}

/** Demande un paiement ; renvoie le jeton et l'adresse de la page PayTech. */
export async function requestPayment(
  request: PaymentRequest,
  ownKeys?: Keys | null,
): Promise<{ token: string; redirectUrl: string }> {
  const keys = ownKeys === undefined ? await payTechKeys() : ownKeys;
  if (!keys) {
    throw new AppError(
      'Le paiement en ligne n’est pas encore activé. Payez en espèces auprès de votre administrateur.',
      'conflict',
    );
  }
  const response = await fetch(`${API}/payment/request-payment`, {
    method: 'POST',
    headers: {
      API_KEY: keys.apiKey,
      API_SECRET: keys.apiSecret,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      item_name: request.itemName,
      item_price: request.itemPrice,
      currency: 'XOF',
      ref_command: request.refCommand,
      command_name: request.commandName,
      env: request.env,
      ipn_url: request.ipnUrl,
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      custom_field: JSON.stringify(request.customField),
      target_payment: request.targetPayment,
    }),
  });
  const body = await response.json().catch(() => null);
  const redirectUrl = body?.redirect_url ?? body?.redirectUrl;
  if (!response.ok || Number(body?.success) !== 1 || !body?.token || !redirectUrl) {
    console.error('PayTech request-payment refusé', response.status, body?.message ?? '');
    throw new AppError(
      'Le service de paiement est indisponible pour le moment. Réessayez dans quelques minutes.',
    );
  }
  return { token: String(body.token), redirectUrl: String(redirectUrl) };
}

/** Champs d'une notification PayTech (formulaire ou JSON). */
export type IpnFields = Record<string, string>;

export async function readIpn(req: Request): Promise<IpnFields> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    return Object.fromEntries(
      Object.entries(body ?? {}).map(([key, value]) => [key, value == null ? '' : String(value)]),
    );
  }
  const form = await req.formData().catch(() => null);
  if (!form) return {};
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
}

/**
 * La notification vient-elle de PayTech ? Signature HMAC-SHA256 (clé : notre clé secrète,
 * message : montant|ref_command|clé API) si elle est fournie ; sinon empreintes SHA-256
 * de nos deux clés. Comparaisons en temps constant.
 */
export async function ipnIsAuthentic(
  fields: IpnFields,
  ownKeys?: Keys | null,
): Promise<boolean> {
  const keys = ownKeys === undefined ? await payTechKeys() : ownKeys;
  if (!keys) return false;
  if (fields.hmac_compute) {
    const amount = fields.final_item_price || fields.item_price || '';
    const expected = await hmacHex(keys.apiSecret, `${amount}|${fields.ref_command}|${keys.apiKey}`);
    return safeEqual(expected, fields.hmac_compute.toLowerCase());
  }
  if (!fields.api_key_sha256 || !fields.api_secret_sha256) return false;
  const [keyHash, secretHash] = await Promise.all([
    sha256Hex(keys.apiKey),
    sha256Hex(keys.apiSecret),
  ]);
  return (
    safeEqual(keyHash, fields.api_key_sha256.toLowerCase()) &&
    safeEqual(secretHash, fields.api_secret_sha256.toLowerCase())
  );
}

/** custom_field : JSON, parfois encodé en Base64 selon la documentation. */
export function readCustomField(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  for (const candidate of [raw, (() => {
    try {
      return atob(raw);
    } catch {
      return '';
    }
  })()]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // essai suivant
    }
  }
  return {};
}
