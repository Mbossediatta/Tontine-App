// Journal d'audit simulé : chaque action sensible y laisse une trace (qui, quoi, quand).
// Le futur backend écrira ces entrées côté serveur, au même moment.
import type { AuditAction, User } from '@/types';
import { db, newId, nowIso } from './db';

/**
 * Ajoute une entrée au journal d'audit.
 * @param actor   personne qui fait l'action
 * @param summary phrase sans le nom de l'auteur, ex. « a créé le groupe « Keur Massar » »
 */
export function recordAudit(
  actor: User,
  action: AuditAction,
  summary: string,
  groupId?: string,
): void {
  db.auditLog.push({
    id: newId('audit'),
    actorId: actor.id,
    action,
    summary,
    groupId,
    at: nowIso(),
  });
}
