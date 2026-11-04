/**
 * Fournisseur de SMS.
 * La version simulée affiche le message dans la console du navigateur ; pour passer à
 * un vrai fournisseur (Orange SMS API, Twilio…), il suffit d'écrire une autre
 * implémentation de cette interface et de la choisir dans services/smsProvider.ts.
 */
export interface SmsService {
  /** Envoie `message` au numéro (9 chiffres, sans l'indicatif +221). */
  send(phone: string, message: string): Promise<void>;
}
