// Envoi automatique d'une cagnotte validée (bouton « Envoyer automatiquement » de l'admin) :
// svc_payout_transfer_prepare vérifie les droits et donne montant et numéro ; le transfert
// part par _shared/paytech-transfer.ts ; il est ensuite noté comme un envoi manuel
// (référence PayTech, bénéficiaire prévenu, qui confirme la réception).
import { admin, caller, checkBusiness } from '../_shared/db.ts';
import { readJson, serve, stringField } from '../_shared/http.ts';
import { sendTransfer } from '../_shared/paytech-transfer.ts';

interface Prepared {
  amount: number;
  phone: string;
  method: 'wave' | 'orange_money';
  groupName: string;
  roundNumber: number;
}

serve(async (req) => {
  const actor = await caller(req);
  const body = await readJson(req);
  const roundId = stringField(body, 'roundId');
  const userId = stringField(body, 'userId');

  const prepared = checkBusiness(
    await admin().rpc('svc_payout_transfer_prepare', {
      p_actor: actor.id,
      p_round: roundId,
      p_user: userId,
    }),
  ) as Prepared;

  const { providerRef } = await sendTransfer({
    amount: prepared.amount,
    phone: prepared.phone,
    method: prepared.method,
    reference: `${roundId}:${userId}`,
    label: `Cagnotte ${prepared.groupName} – tour ${prepared.roundNumber}`,
  });

  checkBusiness(
    await admin().rpc('svc_payout_transfer_done', {
      p_actor: actor.id,
      p_round: roundId,
      p_user: userId,
      p_method: prepared.method,
      p_ref: providerRef,
    }),
  );
  return { providerRef };
});
