import { subDays } from 'date-fns';
import { ServiceError } from '@/lib/errors';
import type { AnnouncementTarget, SmsKind, User } from '@/types';
import type { CommunicationService } from '../communication.service';
import { assertSuperAdmin, requireGroup } from './access';
import { recordAudit } from './audit';
import { currentUser, db, delay, persist, requireOnline } from './db';
import { notify } from './lifecycle';

async function authorize(): Promise<User> {
  requireOnline();
  await delay();
  const actor = currentUser();
  assertSuperAdmin(actor);
  return actor;
}

function recipients(target: AnnouncementTarget): User[] {
  if (target.kind === 'group') {
    requireGroup(target.groupId);
    const memberIds = new Set(
      db.memberships
        .filter(
          (membership) => membership.groupId === target.groupId && membership.status === 'active',
        )
        .map((membership) => membership.userId),
    );
    return db.users.filter((user) => memberIds.has(user.id) && !user.deletedAt);
  }
  return db.users.filter(
    (user) => !user.deletedAt && (target.kind !== 'admins' || user.globalRole === 'admin'),
  );
}

const SMS_LABELS: Record<SmsKind, string> = {
  otp: 'Code de connexion',
  reminder: 'Rappel',
  announcement: 'Annonce',
  payment: 'Confirmation de paiement',
  payout: 'Avis de versement',
};

export const mockCommunicationService: CommunicationService = {
  async announce(target, title, message) {
    const actor = await authorize();
    const cleanTitle = title.trim();
    const cleanMessage = message.trim();
    if (!cleanTitle || !cleanMessage) {
      throw new ServiceError('Le titre et le message de l’annonce sont obligatoires.');
    }
    const users = recipients(target);
    const groupName = target.kind === 'group' ? requireGroup(target.groupId).name : undefined;
    for (const user of users) {
      notify(
        user.id,
        'announcement',
        cleanTitle,
        cleanMessage,
        target.kind === 'group' ? `/groupes/${target.groupId}` : undefined,
      );
    }
    recordAudit(
      actor,
      'announcement_sent',
      `a envoyé l’annonce « ${cleanTitle} » à ${groupName ? `« ${groupName} »` : target.kind === 'admins' ? 'tous les administrateurs' : 'toute la plateforme'}`,
      target.kind === 'group' ? target.groupId : undefined,
    );
    persist();
    return users.length;
  },

  async smsStats(days) {
    await delay();
    assertSuperAdmin(currentUser());
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new ServiceError('La période doit être comprise entre 1 et 365 jours.');
    }
    const cutoff = subDays(new Date(), days);
    const records = db.smsLog
      .filter((sms) => new Date(sms.at) >= cutoff)
      .sort((a, b) => b.at.localeCompare(a.at));
    const kinds: SmsKind[] = ['otp', 'reminder', 'announcement', 'payment', 'payout'];
    const byKind = kinds.map((kind) => {
      const entries = records.filter((sms) => sms.kind === kind);
      return {
        kind,
        count: entries.length,
        cost: entries.reduce((sum, sms) => sum + sms.cost, 0),
      };
    });
    return {
      count: records.length,
      cost: records.reduce((sum, sms) => sum + sms.cost, 0),
      byKind,
      recent: records.slice(0, 30).map((sms) => ({
        ...sms,
        name: db.users.find((user) => user.phone === sms.phone)?.firstName,
      })),
    };
  },
};

export { SMS_LABELS };
