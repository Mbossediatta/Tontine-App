// Envoi des rappels des organisations par SMS et par courriel (cahier AFP § 9.3).
// Appelée toutes les 5 minutes par la base (private.org_deliveries_kick) avec le secret
// partagé ORG_NOTIFY_SECRET, seulement quand des envois attendent. Prend un lot dans la
// file (chaque envoi n'est pris qu'une fois), envoie, puis note l'état de chaque envoi.
// - SMS : même compte Orange que les codes de connexion (_shared/orange-sms.ts), signé du
//   sigle de l'organisation si ORANGE_SIGNATURE_<SIGLE> est configuré.
// - Courriel : serveur SMTP de l'organisation (SMTP_HOST, SMTP_PORT, SMTP_USER,
//   SMTP_PASSWORD, SMTP_FROM). Sans ces réglages, l'envoi est noté « non configuré ».
import nodemailer from 'npm:nodemailer@6.9.16';
import { admin, check } from '../_shared/db.ts';
import { requireEnv, safeEqual } from '../_shared/crypto.ts';
import { AppError, serve } from '../_shared/http.ts';
import { orgSender, sendSms } from '../_shared/orange-sms.ts';

interface Delivery {
  id: string;
  channel: 'sms' | 'email';
  destination: string;
  subject: string;
  body: string;
  userId: string | null;
  shortName: string;
  organizationName: string;
}

const NOT_CONFIGURED = 'not_configured';

function mailer() {
  const host = Deno.env.get('SMTP_HOST')?.trim();
  const user = Deno.env.get('SMTP_USER')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD') ?? '';
  const from = Deno.env.get('SMTP_FROM')?.trim();
  if (!host || !from) return null;
  // 465 : connexion chiffrée d'emblée (les ports 25 et 587 sont souvent bloqués à la sortie
  // des fonctions hébergées).
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465');
  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
    }),
  };
}

/** Courriel simple et sobre : texte brut et version HTML équivalente. */
function emailHtml(d: Delivery): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1B2733">
  <p style="font-weight:bold;color:#12407A;margin:0 0 12px">${escape(d.organizationName)}</p>
  <p style="font-size:15px;line-height:22px;margin:0 0 16px">${escape(d.body)}</p>
  <p style="font-size:12px;color:#5B6B7A;margin:0">Message automatique de l’espace ${escape(d.shortName)} – Calebasse de l’Espoir. Vous pouvez couper les rappels dans votre profil.</p>
</div>`;
}

serve(async (req) => {
  if (!safeEqual(req.headers.get('x-notify-secret') ?? '', requireEnv('ORG_NOTIFY_SECRET'))) {
    throw new AppError('Appel refusé.', 'forbidden');
  }
  const batch = check(await admin().rpc('svc_org_deliveries_claim', { p_limit: 50 })) as Delivery[];
  const mail = mailer();
  let sent = 0;
  let failed = 0;

  for (const d of batch) {
    let ok = false;
    let error: string | null = null;
    try {
      if (d.channel === 'sms') {
        await sendSms(
          d.destination,
          `${d.shortName} – ${d.body}`.slice(0, 300),
          'reminder',
          d.userId ?? undefined,
          orgSender(d.shortName),
        );
        ok = true;
      } else if (!mail) {
        error = NOT_CONFIGURED;
      } else {
        await mail.transport.sendMail({
          from: mail.from,
          to: d.destination,
          subject: d.subject,
          text: `${d.body}\n\n${d.organizationName} – message automatique. Vous pouvez couper les rappels dans votre profil.`,
          html: emailHtml(d),
        });
        ok = true;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`Envoi ${d.channel} échoué (${d.id})`, error);
    }
    check(await admin().rpc('svc_org_delivery_done', { p_id: d.id, p_ok: ok, p_error: error }));
    if (ok) sent += 1;
    else failed += 1;
  }
  return { taken: batch.length, sent, failed };
});
