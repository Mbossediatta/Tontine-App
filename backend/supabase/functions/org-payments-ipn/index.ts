// Notification de paiement PayTech (IPN) pour une organisation. Sans session : signature
// vérifiée avec les clés PayTech de l'organisation concernée. Idempotente : une notification
// déjà traitée ne change rien. Seule une notification valide crée le paiement et son reçu.
import { admin, check, recordSecurityEvent } from '../_shared/db.ts';
import { AppError, clientIp, serve } from '../_shared/http.ts';
import { ipnIsAuthentic, orgPayTechKeys, readCustomField, readIpn } from '../_shared/paytech.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  const fields = await readIpn(req);
  const custom = readCustomField(fields.custom_field);
  const intentId = String(custom.intent_id ?? fields.ref_command ?? '');
  if (!UUID.test(intentId)) {
    console.error('IPN PayTech (organisation) sans référence exploitable');
    return { ok: true };
  }
  const intent = check(await admin().rpc('svc_org_payment_org', { p_intent: intentId })) as {
    shortName: string;
  } | null;
  if (!intent || !(await ipnIsAuthentic(fields, orgPayTechKeys(intent.shortName)))) {
    await recordSecurityEvent({
      kind: 'access_denied',
      severity: 'critical',
      detail: 'Notification de paiement (organisation) refusée : signature PayTech invalide',
      ip: clientIp(req),
    });
    throw new AppError('Notification refusée.', 'forbidden');
  }

  if (fields.type_event === 'sale_complete') {
    const charged = Math.round(Number(fields.item_price));
    const result = check(
      await admin().rpc('svc_org_payment_confirm', {
        p_intent: intentId,
        p_charged: Number.isFinite(charged) ? charged : -1,
        p_provider_ref: fields.token || null,
        p_phone: fields.client_phone || null,
      }),
    ) as string;
    if (result === 'mismatch' || result === 'not_found' || result === 'closed') {
      await recordSecurityEvent({
        kind: 'access_denied',
        severity: 'warning',
        detail: `Notification de paiement (organisation) non appliquée (${result}) : ${intentId}`,
        ip: clientIp(req),
      });
    }
    return { ok: true, result };
  }
  if (fields.type_event === 'sale_canceled') {
    check(await admin().rpc('svc_org_payment_fail', { p_intent: intentId }));
  }
  return { ok: true };
});
