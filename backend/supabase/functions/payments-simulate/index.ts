// Page de paiement simulée (développement local sans clés PayTech uniquement) : le payeur
// choisit le résultat ; la confirmation suit exactement le chemin d'une vraie notification.
import { admin, caller, check } from '../_shared/db.ts';
import { AppError, readJson, serve, stringField } from '../_shared/http.ts';
import { simulationAllowed } from '../_shared/paytech.ts';

serve(async (req) => {
  if (!(await simulationAllowed())) {
    throw new AppError(
      'La simulation de paiement est réservée au développement local, sans clés PayTech.',
      'forbidden',
    );
  }
  const profile = await caller(req);
  const body = await readJson(req);
  const paymentId = stringField(body, 'paymentId');
  const payment = check(
    await admin()
      .from('payments')
      .select('user_id, amount, service_fee_amount')
      .eq('id', paymentId)
      .maybeSingle(),
  ) as { user_id: string; amount: number; service_fee_amount: number } | null;
  if (!payment || payment.user_id !== profile.id) {
    throw new AppError('Paiement introuvable.', 'not_found');
  }
  if (body.success === true) {
    const result = check(
      await admin().rpc('svc_payment_confirm', {
        p_payment: paymentId,
        p_charged: payment.amount + payment.service_fee_amount,
        p_provider_ref: `SIM-${crypto.randomUUID()}`,
        p_phone: profile.phone,
      }),
    ) as string;
    return { ok: true, result };
  }
  check(await admin().rpc('svc_payment_fail', { p_payment: paymentId }));
  return { ok: true };
});
