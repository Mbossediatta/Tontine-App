// Envoi automatique d'une cagnotte (transfert d'argent vers le Wave ou l'Orange Money du
// bénéficiaire) : c'est ici, et seulement ici, que se branchera l'API de transfert de PayTech
// une fois le compte activé et leur documentation reçue.
//
// Tant que PAYTECH_TRANSFER_ENABLED ne vaut pas « true », l'envoi automatique est refusé
// avec un message clair : l'admin envoie l'argent lui-même puis note la référence (le suivi
// et la confirmation du bénéficiaire sont les mêmes dans les deux cas).
import { AppError } from './http.ts';

export interface TransferRequest {
  /** Montant à envoyer (FCFA). */
  amount: number;
  /** Numéro de reversement du bénéficiaire (9 chiffres, sans +221). */
  phone: string;
  method: 'wave' | 'orange_money';
  /** Référence interne unique (tour et bénéficiaire), pour éviter un double envoi. */
  reference: string;
  /** Texte vu par le bénéficiaire dans son application Wave / Orange Money. */
  label: string;
}

export interface TransferResult {
  /** Référence de la transaction donnée par PayTech. */
  providerRef: string;
}

export function transferEnabled(): boolean {
  return Deno.env.get('PAYTECH_TRANSFER_ENABLED') === 'true';
}

/** Envoie l'argent ; lève une AppError si l'envoi n'a pas pu se faire. */
export async function sendTransfer(request: TransferRequest): Promise<TransferResult> {
  if (!transferEnabled()) {
    throw new AppError(
      'L’envoi automatique n’est pas encore activé : envoyez l’argent par Wave ou Orange Money, puis notez la référence.',
      'conflict',
    );
  }
  // À brancher avec la documentation de transfert de PayTech (adresse, champs, signature,
  // réponse). Ne rien inventer : tant que ce n'est pas fait, l'envoi reste refusé.
  console.error('Transfert PayTech demandé mais pas encore branché', request.reference);
  throw new AppError(
    'L’envoi automatique n’est pas encore branché sur PayTech. Envoyez l’argent puis notez la référence.',
    'conflict',
  );
}
