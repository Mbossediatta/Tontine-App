import type { AccountInput, MemberProfile, MemberSummary } from '@/types';

/** Gestion des membres de la plateforme (super administrateur). */
export interface MemberService {
  /** Tous les membres ; `query` filtre sur le nom ou le numéro. */
  list(query?: string): Promise<MemberSummary[]>;
  get(userId: string): Promise<MemberProfile>;
  /** Crée un compte participant ; à sa 1re connexion, code SMS puis création du PIN. Renvoie son id. */
  create(input: AccountInput): Promise<string>;
  block(userId: string): Promise<void>;
  unblock(userId: string): Promise<void>;
  /** Oblige à recréer le PIN (après un code SMS) à la prochaine connexion. */
  resetPin(userId: string): Promise<void>;
  /** Change le numéro après vérification du code SMS reçu sur le nouveau numéro. */
  changePhone(userId: string, newPhone: string, code: string): Promise<void>;
  /** Super admin : corriger le prénom et le nom. */
  update(userId: string, firstName: string, lastName: string): Promise<void>;
  /** Super admin : supprimer (anonymiser) le compte, avec un motif. */
  remove(userId: string, reason: string): Promise<void>;
}
