// Page de paiement simulée pour une organisation : développement local, sans clés PayTech
// de l'organisation. La confirmation suit exactement le chemin d'une vraie notification.
import { admin, caller, check } from '../_shared/db.ts';
import { AppError, readJson, serve, stringField } from '../_shared/http.ts';
import { isLocal } from '../_shared/orange-sms.ts';
import { orgPayTechKeys } from '../_shared/paytech.ts';

serve(async (req) => {
  const profile = await caller(req);
  const body = await readJson(req);
  const intentId = stringField(body, 'intentId');
  const intent = check(await admin().rpc('svc_org_payment_org', { p_intent: intentId })) as {
    shortName: string;
    userId: string;
    amount: number;
    serviceFee: number;
  } | null;
  if (!intent || intent.userId !== profile.id) {
    throw new AppError('Paiement introuvable.', 'not_found');
  }
  if (!isLocal() || orgPayTechKeys(intent.shortName)) {
    throw new AppError(
      'La simulation de paiement est réservée au développement local, sans clés PayTech.',
      'forbidden',
    );
  }
  if (body.success === true) {
    const result = check(
      await admin().rpc('svc_org_payment_confirm', {
        p_intent: intentId,
        p_charged: intent.amount + intent.serviceFee,
        p_provider_ref: `SIM-${crypto.randomUUID()}`,
        p_phone: profile.phone,
      }),
    ) as string;
    return { ok: true, result };
  }
  check(await admin().rpc('svc_org_payment_fail', { p_intent: intentId }));
  return { ok: true };
});
