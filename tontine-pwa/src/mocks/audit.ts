import { subDays, subHours } from 'date-fns';
import type { AuditEntry } from '@/types';

/** Quelques actions passées, pour que le journal d'audit de démonstration ne soit pas vide. */
export function seedAudit(now: Date = new Date()): AuditEntry[] {
  const at = (date: Date) => date.toISOString();
  return [
    {
      id: 'audit-1',
      actorId: 'u-super',
      action: 'settings_updated',
      summary: 'a mis à jour les clés du service de paiement',
      at: at(subDays(now, 4)),
    },
    {
      id: 'audit-2',
      actorId: 'u-admin2',
      action: 'group_updated',
      summary: 'a modifié le montant de cotisation de « Tontine Thiaroye » (10 000 FCFA)',
      groupId: 'g-thiaroye',
      at: at(subDays(now, 3)),
    },
    {
      id: 'audit-3',
      actorId: 'u-super',
      action: 'group_suspended',
      summary: 'a suspendu le groupe « Entraide Pikine »',
      groupId: 'g-pikine',
      at: at(subDays(now, 1)),
    },
    {
      id: 'audit-4',
      actorId: 'u-admin2',
      action: 'group_created',
      summary: 'a créé le groupe « Collègues du bureau »',
      groupId: 'g-bureau',
      at: at(subHours(now, 20)),
    },
    {
      id: 'audit-5',
      actorId: 'u-admin1',
      action: 'payout_validated',
      summary: 'a validé le versement du tour 2 de « Tontine Famille »',
      groupId: 'g-famille',
      at: at(subHours(now, 2)),
    },
  ];
}
