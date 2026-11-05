// Envoi de SMS par Orange SMS Pro (Sénégal), côté serveur uniquement (section 4.10).
//
// Protocole (exemple fourni par Orange SMS Pro) : POST du formulaire
//   token, subject, signature, recipient, content, timestamp, key
// avec key = HMAC-SHA1(token + subject + signature + recipient + content + timestamp, ORANGE_API_KEY)
// et une authentification Basic ORANGE_LOGIN:ORANGE_TOKEN. Le certificat HTTPS est vérifié.
//
// En local, SMS_MODE=console écrit le SMS dans les journaux de la fonction au lieu de
// l'envoyer (refusé hors de la machine locale).
import { admin, check } from './db.ts';
import { requireEnv } from './crypto.ts';

export type SmsKind = 'otp' | 'reminder' | 'announcement' | 'payment' | 'payout';

async function hmacSha1Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isLocal(): boolean {
  const host = new URL(requireEnv('SUPABASE_URL')).hostname;
  return ['kong', 'localhost', '127.0.0.1', 'host.docker.internal'].includes(host);
}

async function sendWithOrange(phone: string, text: string): Promise<void> {
  const token = requireEnv('ORANGE_TOKEN');
  const subject = requireEnv('ORANGE_SUBJECT');
  const signature = requireEnv('ORANGE_SIGNATURE');
  const recipient = `+221${phone}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await hmacSha1Hex(
    requireEnv('ORANGE_API_KEY'),
    token + subject + signature + recipient + text + timestamp,
  );

  const response = await fetch(requireEnv('ORANGE_BASE_URL'), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${requireEnv('ORANGE_LOGIN')}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token, subject, signature, recipient, content: text, timestamp, key }),
  });
  const reply = (await response.text()).slice(0, 300);
  if (!response.ok) {
    // La réponse d'Orange ne contient pas le message : on peut la journaliser.
    throw new Error(`Orange SMS Pro : envoi refusé (${response.status}) ${reply}`);
  }
}

/** Envoie un SMS au numéro (9 chiffres) et le note dans sms_log pour le suivi des coûts. */
export async function sendSms(phone: string, text: string, kind: SmsKind, userId?: string): Promise<void> {
  if (Deno.env.get('SMS_MODE') === 'console') {
    if (!isLocal()) throw new Error('SMS_MODE=console est réservé au développement local');
    console.log(`[SMS local] ${phone} : ${text}`);
  } else {
    await sendWithOrange(phone, text);
  }
  const settings = check(await admin().from('platform_settings').select('sms').single()) as {
    sms: { costPerSms: number };
  };
  check(
    await admin().from('sms_log').insert({
      phone, kind, cost: settings.sms.costPerSms ?? 0, user_id: userId ?? null,
    }),
  );
}
