import { ServiceError } from '@/lib/errors';
import { fullName, normalizePhone, searchable } from '@/lib/format';
import type { MemberSummary, User } from '@/types';
import type { MemberService } from '../member.service';
import { assertSuperAdmin } from './access';
import { recordAudit } from './audit';
import { synchronize } from './clock';
import { currentUser, db, delay, newId, nowIso, persist, requireOnline, requireUser } from './db';
import { notify } from './lifecycle';
import { checkOtp } from './otp';
import { needsPin, requirePinReset } from './pin';
import { allTransactions, latesOf } from './platform';

/** Membre gérable par le super administrateur : tout compte actif sauf le sien. */
function requireMember(userId: string): User {
  const user = requireUser(userId);
  if (user.globalRole === 'super_admin') {
    throw new ServiceError('Le compte du super administrateur ne se gère pas ici.', 'forbidden');
  }
  if (user.deletedAt) throw new ServiceError('Ce compte a été supprimé.', 'not_found');
  return user;
}

/** Super administrateur connecté (lève une erreur sinon), avec la connexion exigée. */
async function superAdminAction(): Promise<User> {
  requireOnline();
  await delay();
  const actor = currentUser();
  assertSuperAdmin(actor);
  return actor;
}

/** Ligne de liste : nombre de groupes actifs, retards en cours, PIN à recréer. */
function summarize(user: User): MemberSummary {
  return {
    user,
    groupCount: new Set(
      db.memberships
        .filter((m) => m.userId === user.id && m.status === 'active')
        .map((membership) => membership.groupId),
    ).size,
    lateCount: latesOf(user.id).length,
    pinPending: needsPin(user.id),
  };
}

export const mockMemberService: MemberService = {
  async list(query = '') {
    await delay();
    synchronize();
    assertSuperAdmin(currentUser());
    const words = searchable(query.trim());
    const digits = query.replace(/\D/g, '');
    return db.users
      .filter((u) => u.globalRole !== 'super_admin' && !u.deletedAt)
      .filter((u) => {
        if (!words) return true;
        // Un numéro se cherche par ses chiffres, un nom par ses lettres.
        if (digits.length >= 3 && u.phone.includes(digits)) return true;
        return searchable(fullName(u)).includes(words);
      })
      .sort((a, b) => fullName(a).localeCompare(fullName(b), 'fr'))
      .map(summarize);
  },

  async get(userId) {
    await delay();
    synchronize();
    assertSuperAdmin(currentUser());
    const user = requireMember(userId);
    const groups = [
      ...new Set(
        db.memberships
          .filter((m) => m.userId === user.id && m.status !== 'removed')
          .map((membership) => membership.groupId),
      ),
    ].flatMap((groupId) => {
      const membership = db.memberships.find(
        (item) => item.groupId === groupId && item.userId === user.id && item.status !== 'removed',
      );
      const group = db.groups.find((item) => item.id === groupId);
      if (!membership || !group) return [];
      const shareCount = db.memberships.filter(
        (item) => item.groupId === groupId && item.userId === user.id && item.status === 'active',
      ).length;
      return [{ group, role: membership.role, status: membership.status, shareCount }];
    });
    const received = db.rounds
      .filter(
        (round) =>
          round.status === 'paid_out' &&
          round.recipientType !== 'platform' &&
          (round.beneficiaryAmounts
            ? (round.beneficiaryAmounts[user.id] ?? 0) > 0
            : round.beneficiaryId === user.id),
      )
      .map((round) => ({
        groupId: round.groupId,
        groupName: db.groups.find((g) => g.id === round.groupId)?.name ?? '—',
        round,
      }));
    return {
      summary: summarize(user),
      groups,
      payments: allTransactions(user.id),
      lates: latesOf(user.id),
      received,
    };
  },

  async create(input) {
    const actor = await superAdminAction();
    const phone = normalizePhone(input.phone);
    if (!/^\d{9}$/.test(phone)) throw new ServiceError('Numéro de téléphone invalide.');
    if (db.users.some((u) => u.phone === phone && !u.deletedAt)) {
      throw new ServiceError('Un compte existe déjà avec ce numéro.', 'conflict');
    }
    const user: User = {
      id: newId('u'),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone,
      globalRole: 'user',
      isSuspended: false,
      createdAt: nowIso(),
    };
    db.users.push(user);
    recordAudit(actor, 'member_created', `a créé le compte de ${fullName(user)}`);
    persist();
    return user.id;
  },

  async block(userId) {
    const actor = await superAdminAction();
    const user = requireMember(userId);
    user.isSuspended = true;
    recordAudit(actor, 'member_blocked', `a bloqué le compte de ${fullName(user)}`);
    persist();
  },

  async update(userId, firstName, lastName) {
    const actor = await superAdminAction();
    const user = requireMember(userId);
    const first = firstName.trim();
    const last = lastName.trim();
    if (first.length < 2 || last.length < 2 || first.length > 40 || last.length > 40) {
      throw new ServiceError('Prénom et nom : entre 2 et 40 caractères chacun.');
    }
    const before = fullName(user);
    user.firstName = first;
    user.lastName = last;
    recordAudit(actor, 'member_updated', `a renommé ${before} en ${first} ${last}`);
    persist();
  },

  async remove(userId, reason) {
    const actor = await superAdminAction();
    const user = requireMember(userId);
    if (reason.trim().length < 3) throw new ServiceError('Indiquez le motif de la suppression.');
    const before = fullName(user);
    user.firstName = 'Compte';
    user.lastName = 'supprimé';
    user.isSuspended = true;
    user.deletedAt = new Date().toISOString();
    recordAudit(actor, 'member_deleted', `a supprimé le compte de ${before} : ${reason.trim()}`);
    persist();
  },

  async unblock(userId) {
    const actor = await superAdminAction();
    const user = requireMember(userId);
    user.isSuspended = false;
    recordAudit(actor, 'member_unblocked', `a débloqué le compte de ${fullName(user)}`);
    persist();
  },

  async resetPin(userId) {
    const actor = await superAdminAction();
    const user = requireMember(userId);
    requirePinReset(user.id);
    notify(
      user.id,
      'security',
      'PIN réinitialisé',
      'À votre prochaine connexion, vous recevrez un code par SMS pour créer un nouveau PIN.',
    );
    recordAudit(actor, 'pin_reset', `a réinitialisé le PIN de ${fullName(user)}`);
    persist();
  },

  async changePhone(userId, newPhone, code) {
    const actor = await superAdminAction();
    const user = requireMember(userId);
    const phone = normalizePhone(newPhone);
    if (!/^\d{9}$/.test(phone)) throw new ServiceError('Numéro de téléphone invalide.');
    if (phone === user.phone) throw new ServiceError('C’est déjà son numéro actuel.');
    if (db.users.some((u) => u.phone === phone && !u.deletedAt)) {
      throw new ServiceError('Ce numéro est déjà utilisé par un autre compte.', 'conflict');
    }
    // Le code a été envoyé par SMS au NOUVEAU numéro : la personne prouve qu'il est à elle.
    checkOtp(phone, code);
    const previous = user.phone;
    user.phone = phone;
    // Le numéro de reversement suivait l'ancien numéro : on le met à jour aussi.
    if (user.payoutPhone === previous) user.payoutPhone = phone;
    recordAudit(actor, 'phone_changed', `a changé le numéro de ${fullName(user)}`);
    persist();
  },
};
