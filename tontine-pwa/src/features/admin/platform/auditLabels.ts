import type { AuditAction } from '@/types';

/** Familles d'actions du journal : filtre et pastille de couleur. */
export type AuditCategory = 'groups' | 'money' | 'admins' | 'members' | 'platform' | 'logins';

export const auditCategories: Record<AuditCategory, { label: string; dot: string }> = {
  groups: { label: 'Groupes et communautés', dot: 'bg-blue-700' },
  money: { label: 'Argent et versements', dot: 'bg-green-600' },
  admins: { label: 'Administrateurs', dot: 'bg-warning' },
  // Rond creux : se distingue des groupes sans ajouter de couleur.
  members: { label: 'Membres', dot: 'bg-white ring-2 ring-inset ring-blue-700' },
  platform: { label: 'Paramètres et annonces', dot: 'bg-muted' },
  logins: { label: 'Connexions', dot: 'bg-blue-300' },
};

/** Libellé français et famille de chaque action (le type garantit qu'aucune n'est oubliée). */
export const auditActions: Record<AuditAction, { label: string; category: AuditCategory }> = {
  group_created: { label: 'Groupe créé', category: 'groups' },
  group_updated: { label: 'Groupe modifié', category: 'groups' },
  group_suspended: { label: 'Groupe suspendu', category: 'groups' },
  group_reactivated: { label: 'Groupe réactivé', category: 'groups' },
  group_closed: { label: 'Groupe clôturé', category: 'groups' },
  group_archived: { label: 'Groupe archivé', category: 'groups' },
  group_admin_changed: { label: 'Admin du groupe changé', category: 'groups' },
  group_community_changed: { label: 'Groupe changé de communauté', category: 'groups' },
  community_created: { label: 'Communauté créée', category: 'groups' },
  community_updated: { label: 'Communauté modifiée', category: 'groups' },
  payout_validated: { label: 'Versement validé', category: 'money' },
  payout_blocked: { label: 'Versement bloqué', category: 'money' },
  payout_unblocked: { label: 'Versement débloqué', category: 'money' },
  cash_recorded: { label: 'Paiement en espèces enregistré', category: 'money' },
  refund_validated: { label: 'Remboursement validé', category: 'money' },
  dispute_updated: { label: 'Litige mis à jour', category: 'money' },
  admin_compensated: { label: 'Admin rémunéré', category: 'money' },
  reminder_sent: { label: 'Relance de cotisation', category: 'money' },
  admin_added: { label: 'Admin ajouté', category: 'admins' },
  admin_updated: { label: 'Admin modifié', category: 'admins' },
  admin_suspended: { label: 'Admin suspendu', category: 'admins' },
  admin_reactivated: { label: 'Admin réactivé', category: 'admins' },
  admin_revoked: { label: 'Droits d’admin retirés', category: 'admins' },
  admin_deleted: { label: 'Admin supprimé', category: 'admins' },
  groups_reassigned: { label: 'Groupes réattribués', category: 'admins' },
  member_created: { label: 'Membre ajouté', category: 'members' },
  member_blocked: { label: 'Membre bloqué', category: 'members' },
  member_unblocked: { label: 'Membre débloqué', category: 'members' },
  phone_changed: { label: 'Numéro changé', category: 'members' },
  pin_reset: { label: 'PIN réinitialisé', category: 'members' },
  settings_updated: { label: 'Paramètres modifiés', category: 'platform' },
  announcement_sent: { label: 'Annonce envoyée', category: 'platform' },
  login: { label: 'Connexion', category: 'logins' },
};

/** Libellé d'une action ; repli lisible si le serveur en ajoute une nouvelle. */
export function auditActionLabel(action: string): string {
  return auditActions[action as AuditAction]?.label ?? action.replaceAll('_', ' ');
}

export function auditCategoryOf(action: string): AuditCategory {
  return auditActions[action as AuditAction]?.category ?? 'platform';
}
