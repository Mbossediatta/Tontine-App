// Notification de paiement de PayTech (IPN). Appelée par PayTech, sans session : son
// authenticité est vérifiée par signature (voir ipnIsAuthentic). Idempotente : une
// notification déjà traitée ne change rien. Répond 200 dès qu'elle est traitée.
import { admin, check, recordSecurityEvent } from '../_shared/db.ts';
import { AppError, clientIp, serve } from '../_shared/http.ts';
import { ipnIsAuthentic, readCustomField, readIpn } from '../_shared/paytech.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  const fields = await readIpn(req);
  if (!(await ipnIsAuthentic(fields))) {
    await recordSecurityEvent({
      kind: 'access_denied',
      severity: 'critical',
      detail: 'Notification de paiement refusée : signature PayTech invalide',
      ip: clientIp(req),
    });
    throw new AppError('Notification refusée.', 'forbidden');
  }

  const custom = readCustomField(fields.custom_field);
  const paymentId = String(custom.payment_id ?? fields.ref_command ?? '');
  if (!UUID.test(paymentId)) {
    console.error('IPN PayTech sans référence de paiement exploitable');
    return { ok: true };
  }

  if (fields.type_event === 'sale_complete') {
    // Montant demandé à PayTech (item_price) : doit être exactement celui attendu. En test,
    // PayTech débite un petit montant au hasard, mais item_price reste celui demandé.
    const charged = Math.round(Number(fields.item_price));
    const result = check(
      await admin().rpc('svc_payment_confirm', {
        p_payment: paymentId,
        p_charged: Number.isFinite(charged) ? charged : -1,
        p_provider_ref: fields.token || null,
        p_phone: fields.client_phone || null,
      }),
    ) as string;
    if (result === 'mismatch' || result === 'not_found' || result === 'closed') {
      await recordSecurityEvent({
        kind: 'access_denied',
        severity: 'warning',
        detail: `Notification de paiement non appliquée (${result}) pour le paiement ${paymentId}`,
        ip: clientIp(req),
      });
    }
    return { ok: true, result };
  }
  if (fields.type_event === 'sale_canceled') {
    check(await admin().rpc('svc_payment_fail', { p_payment: paymentId }));
  }
  return { ok: true };
});
