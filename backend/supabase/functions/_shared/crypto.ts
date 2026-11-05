// Empreintes, jetons de preuve et mot de passe interne (section 4.1 du cahier).
import { argon2id, argon2Verify } from 'npm:hash-wasm@4.11.0';
import { AppError } from './http.ts';

const encoder = new TextEncoder();

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret manquant : ${name}`);
  return value;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export async function sha256Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(message)));
}

/** Comparaison en temps constant de deux chaînes. */
export function safeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** Code SMS à 6 chiffres, tiré par le générateur cryptographique (sans biais notable). */
export function randomOtp(): string {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
  return String(value % 1_000_000).padStart(6, '0');
}

export const otpHash = (phone: string, code: string) =>
  hmacHex(requireEnv('OTP_PEPPER'), `${phone}:${code}`);

// --- PIN : Argon2id (paramètres OWASP) sur un HMAC du PIN avec le poivre ---

async function pepperedPin(userId: string, pin: string): Promise<string> {
  return hmacHex(requireEnv('PIN_PEPPER'), `${userId}:${pin}`);
}

export async function hashPin(userId: string, pin: string): Promise<string> {
  return argon2id({
    password: await pepperedPin(userId, pin),
    salt: crypto.getRandomValues(new Uint8Array(16)),
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyPin(userId: string, pin: string, hash: string): Promise<boolean> {
  return argon2Verify({ password: await pepperedPin(userId, pin), hash });
}

/** Même règle que le frontend (src/lib/checks.ts) : pas 0000, 1234, 4321… */
export function assertPinFormat(pin: string): void {
  if (!/^[0-9]{4}$/.test(pin)) throw new AppError('Le PIN doit contenir 4 chiffres.');
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, i) => digit - digits[i]);
  if ([0, 1, -1].some((step) => steps.every((s) => s === step))) {
    throw new AppError('Ce PIN est trop facile à deviner. Choisissez-en un autre.');
  }
}

// --- Jeton de preuve : « ce numéro a été vérifié par SMS », valable 10 minutes ---

const PROOF_TTL_SECONDS = 600;

export async function signProof(phone: string): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ phone, exp: Math.floor(Date.now() / 1000) + PROOF_TTL_SECONDS })),
  );
  return `${payload}.${await hmacHex(requireEnv('PROOF_TOKEN_SECRET'), payload)}`;
}

/** Numéro prouvé par le jeton, ou erreur « session expirée ». */
export async function readProof(token: unknown): Promise<string> {
  const expired = new AppError('Session expirée, recommencez la connexion.', 'unauthenticated');
  if (typeof token !== 'string' || !token.includes('.')) throw expired;
  const [payload, signature] = token.split('.');
  const expected = await hmacHex(requireEnv('PROOF_TOKEN_SECRET'), payload);
  if (!safeEqual(signature ?? '', expected)) throw expired;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (typeof data.phone !== 'string' || typeof data.exp !== 'number') throw expired;
    if (data.exp < Date.now() / 1000) throw expired;
    return data.phone;
  } catch {
    throw expired;
  }
}

// --- Identifiants internes de Supabase Auth (jamais montrés, jamais stockés) ---

export const technicalEmail = (userId: string) => `${userId}@users.calebasse.invalid`;

export const internalPassword = (userId: string) => hmacHex(requireEnv('SESSION_PEPPER'), userId);
