// Un militant paie en ligne (Wave, Orange Money) une caisse de son organisation : frais
// d'adhésion, cotisation… La base prépare la demande (montant contrôlé, frais du service
// de paiement en plus), puis PayTech renvoie l'adresse de sa page de paiement.
// L'argent va sur le compte PayTech de l'organisation (PAYTECH_API_KEY_<SIGLE>), jamais
// sur celui de Calebasse. Sans ces clés, en local seulement : page de paiement simulée.
import { requireEnv } from '../_shared/crypto.ts';
import { admin, caller, check, checkBusiness } from '../_shared/db.ts';
import { AppError, readJson, serve, stringField } from '../_shared/http.ts';
import { isLocal } from '../_shared/orange-sms.ts';
import { orgPayTechKeys, payTechEnv, requestPayment, TARGET_PAYMENT } from '../_shared/paytech.ts';

interface Prepared {
  intentId: string;
  amount: number;
  serviceFee: number;
  total: number;
  fundName: string;
  structureName: string;
  shortName: string;
  slug: string;
  mode: string;
}

serve(async (req) => {
  const profile = await caller(req);
  const body = await readJson(req);
  // Une caisse (fundId) ou une contribution libre au fonds commun (target = common, slug).
  const common = body.target === 'common';
  const method = stringField(body, 'method');
  if (method !== 'wave' && method !== 'orange_money') {
    throw new AppError('Choisissez Wave ou Orange Money.');
  }
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError('Montant invalide.');

  const prepared = checkBusiness(
    common
      ? await admin().rpc('svc_org_contribution_prepare', {
          p_user: profile.id,
          p_slug: stringField(body, 'slug'),
          p_amount: amount,
          p_method: method,
        })
      : await admin().rpc('svc_org_payment_prepare', {
          p_user: profile.id,
          p_fund: stringField(body, 'fundId'),
          p_amount: amount,
          p_method: method,
        }),
  ) as Prepared;
  const intent = encodeURIComponent(prepared.intentId);
  const keys = orgPayTechKeys(prepared.shortName);

  if (!keys && isLocal()) {
    return {
      intentId: prepared.intentId,
      checkoutUrl: `/paiement/simulation?intent=${intent}`,
    };
  }

  const appUrl = (Deno.env.get('ORG_APP_URL') ?? requireEnv('APP_URL')).replace(/\/$/, '');
  const ipnUrl = Deno.env.get('ORG_PAYTECH_IPN_URL') ??
    `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/org-payments-ipn`;
  const label = `${prepared.shortName} – ${prepared.fundName} (${prepared.structureName})`.slice(0, 120);
  const { token, redirectUrl } = await requestPayment(
    {
      itemName: label,
      itemPrice: prepared.total,
      refCommand: prepared.intentId,
      commandName: label,
      env: payTechEnv(prepared.mode),
      ipnUrl,
      successUrl: `${appUrl}/paiement/retour?intent=${intent}`,
      cancelUrl: `${appUrl}/paiement/retour?intent=${intent}&annule=1`,
      customField: { intent_id: prepared.intentId },
      targetPayment: TARGET_PAYMENT[method],
    },
    keys,
  );
  check(await admin().rpc('svc_org_payment_set_token', { p_intent: prepared.intentId, p_token: token }));
  return { intentId: prepared.intentId, checkoutUrl: redirectUrl };
});
