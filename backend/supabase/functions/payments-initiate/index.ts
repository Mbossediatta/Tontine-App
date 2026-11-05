// Le membre lance le paiement d'un tour : la ligne « pending » est préparée par la base
// (montant, frais PayTech payés en plus), puis PayTech renvoie l'adresse de sa page de
// paiement. Sans clés PayTech, en local seulement : page de paiement simulée de l'appli.
import { requireEnv } from '../_shared/crypto.ts';
import { admin, caller, check, checkBusiness } from '../_shared/db.ts';
import { AppError, readJson, serve, stringField } from '../_shared/http.ts';
import { payTechEnv, requestPayment, simulationAllowed, TARGET_PAYMENT } from '../_shared/paytech.ts';

interface Prepared {
  paymentId: string;
  amount: number;
  serviceFee: number;
  total: number;
  groupName: string;
  roundNumber: number;
  mode: string;
}

serve(async (req) => {
  const profile = await caller(req);
  const body = await readJson(req);
  const roundId = stringField(body, 'roundId');
  const method = stringField(body, 'method') as keyof typeof TARGET_PAYMENT;
  if (!(method in TARGET_PAYMENT)) throw new AppError('Choisissez Wave, Orange Money ou Free Money.');

  const prepared = checkBusiness(
    await admin().rpc('svc_payment_prepare', { p_user: profile.id, p_round: roundId, p_method: method }),
  ) as Prepared;
  const payment = encodeURIComponent(prepared.paymentId);

  if (await simulationAllowed()) {
    return { paymentId: prepared.paymentId, checkoutUrl: `/paiement/simulation?payment=${payment}` };
  }

  const appUrl = requireEnv('APP_URL').replace(/\/$/, '');
  // Adresse publique de payments-ipn (PayTech doit pouvoir l'appeler en HTTPS).
  const ipnUrl = Deno.env.get('PAYTECH_IPN_URL') ??
    `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/payments-ipn`;
  const label = `Cotisation ${prepared.groupName} – tour ${prepared.roundNumber}`;
  const { token, redirectUrl } = await requestPayment({
    itemName: label,
    itemPrice: prepared.total,
    refCommand: prepared.paymentId,
    commandName: label,
    env: payTechEnv(prepared.mode),
    ipnUrl,
    successUrl: `${appUrl}/paiement/succes?payment=${payment}`,
    cancelUrl: `${appUrl}/paiement/echec?payment=${payment}`,
    customField: { payment_id: prepared.paymentId },
    targetPayment: TARGET_PAYMENT[method],
  });
  check(await admin().rpc('svc_payment_set_token', { p_payment: prepared.paymentId, p_token: token }));
  return { paymentId: prepared.paymentId, checkoutUrl: redirectUrl };
});
