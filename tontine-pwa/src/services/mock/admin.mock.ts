import { isSameMonth, isToday } from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { fullName, normalizePhone, plural } from '@/lib/format';
import type {
  AccountInput,
  Community,
  Group,
  GroupStatus,
  NextPayout,
  PlatformAlert,
  TodoItem,
  SaveCommunityInput,
  TransactionRow,
  User,
} from '@/types';
import type { AdminService } from '../admin.service';
import {
  activeMemberships,
  assertAdmin,
  assertSuperAdmin,
  canManage,
  requireGroup,
} from './access';
import { recordAudit } from './audit';
import { synchronize } from './clock';
import {
  currentUser,
  db,
  delay,
  findUser,
  newId,
  nowIso,
  persist,
  requireOnline,
  requireUser,
} from './db';
import { currentRoundOf, memberStatus, notify, notifyManagers } from './lifecycle';
import { monthlyCollections } from './metrics';
import { adminNameOf, adminPerformance, allTransactions, lateOnRound } from './platform';
import { pageOf } from './paging';
import { buildOverview } from './views';

// --- Règles d'accès ---------------------------------------------------------

/** Compte administrateur modifiable par le super administrateur (jamais lui-même). */
function requireAdminTarget(userId: string): User {
  const target = requireUser(userId);
  if (target.globalRole !== 'admin') {
    throw new ServiceError('Ce compte n’est pas administrateur.', 'forbidden');
  }
  return target;
}

/** Super administrateur connecté (lève une erreur sinon), avec la connexion exigée. */
async function superAdminAction(): Promise<User> {
  requireOnline();
  await delay();
  const actor = currentUser();
  assertSuperAdmin(actor);
  return actor;
}

/** Numéro saisi, nettoyé et vérifié (9 chiffres, libre ou appartenant à `ownerId`). */
function checkedPhone(raw: string, ownerId?: string): string {
  const phone = normalizePhone(raw);
  if (!/^\d{9}$/.test(phone)) throw new ServiceError('Numéro de téléphone invalide.');
  const holder = db.users.find((u) => u.phone === phone && !u.deletedAt);
  if (holder && holder.id !== ownerId) {
    throw new ServiceError('Ce numéro est déjà utilisé par un autre compte.', 'conflict');
  }
  return phone;
}

// --- Tâches « À traiter » d'un groupe ---------------------------------------

/** Adhésions, échanges, versement prêt, paiements échoués. */
function todoFor(group: Group): TodoItem[] {
  const todo: TodoItem[] = [];
  const base = { groupId: group.id, groupName: group.name };
  for (const pending of db.memberships.filter(
    (m) => m.groupId === group.id && m.status === 'pending',
  )) {
    todo.push({
      ...base,
      id: `join-${pending.id}`,
      kind: 'join_request',
      label: `${fullName(requireUser(pending.userId))} demande à rejoindre`,
    });
  }
  for (const swap of db.swapRequests.filter(
    (s) => s.groupId === group.id && s.status === 'pending_admin',
  )) {
    todo.push({
      ...base,
      id: `swap-${swap.id}`,
      kind: 'swap_request',
      label: `Échange de tour : ${fullName(requireUser(swap.requesterId))} ↔ ${fullName(requireUser(swap.partnerId))}`,
    });
  }
  const round = currentRoundOf(group.id);
  if (!round) return todo;
  if (round.status === 'ready_for_payout') {
    todo.push({
      ...base,
      id: `payout-${round.id}`,
      kind: 'ready_for_payout',
      label: `Tour ${round.number} prêt pour le reversement`,
    });
  }
  const checkedUsers = new Set<string>();
  for (const membership of activeMemberships(group.id)) {
    if (
      !checkedUsers.has(membership.userId) &&
      memberStatus(round, membership.userId) === 'failed'
    ) {
      checkedUsers.add(membership.userId);
      todo.push({
        ...base,
        id: `failed-${round.id}-${membership.userId}`,
        kind: 'failed_payment',
        label: `Paiement échoué : ${fullName(requireUser(membership.userId))}`,
      });
    }
  }
  return todo;
}

// --- Service ------------------------------------------------------------------

/** Pénalités du mois, dettes, cagnottes à envoyer, réclamations (comme platform_health). */
function platformHealth(now: Date) {
  const penalties = db.penalties.filter((penalty) => isSameMonth(new Date(penalty.appliedAt), now));
  const openDebts = db.debts.filter((debt) => debt.status === 'open');
  const transfers = db.rounds
    .filter((round) => round.status === 'paid_out' && round.recipientType !== 'platform')
    .flatMap((round) =>
      Object.keys(round.beneficiaryAmounts ?? {}).map((userId) => round.transfers?.[userId]),
    );
  return {
    penaltiesThisMonth: penalties.reduce((sum, penalty) => sum + penalty.amount, 0),
    penaltyCountThisMonth: penalties.length,
    openDebts: openDebts.length,
    openDebtAmount: openDebts.reduce((sum, debt) => sum + debt.amount + debt.penaltyAmount, 0),
    transfersToSend: transfers.filter((transfer) => !transfer).length,
    transfersAwaiting: transfers.filter((transfer) => transfer && !transfer.receivedAt).length,
    openDisputes: db.disputes.filter(
      (dispute) => dispute.status === 'open' || dispute.status === 'in_progress',
    ).length,
  };
}

export const mockAdminService: AdminService = {
  async dashboard() {
    await delay();
    // Applique d'abord les événements datés (confirmations, pénalités) pour des chiffres à jour.
    synchronize();
    const user = currentUser();
    assertAdmin(user);
    const now = new Date();
    // Les groupes archivés ne sont plus suivis au quotidien.
    const groups = db.groups.filter((g) => canManage(g, user) && !g.archivedAt);
    const active = groups.filter((g) => g.status === 'active');
    const activeIds = new Set(active.map((g) => g.id));

    // Attendu / collecté sur les tours dont l'échéance tombe ce mois-ci.
    const [thisMonth] = monthlyCollections(
      db.rounds.filter((r) => activeIds.has(r.groupId)),
      1,
      now,
    );

    // Retards et prochain versement, groupe par groupe (tour en cours uniquement).
    let lateMembers = 0;
    let lateAmount = 0;
    let nextPayout: NextPayout | undefined;
    for (const group of active) {
      const round = currentRoundOf(group.id);
      if (!round) continue;
      const late = lateOnRound(group, round, now);
      lateMembers += late.length;
      lateAmount += late.reduce((sum, l) => sum + l.amount, 0);
      // On garde le versement dont la date limite est la plus proche.
      if (!nextPayout || new Date(round.dueDate) < new Date(nextPayout.date)) {
        nextPayout = {
          date: round.dueDate,
          groupId: group.id,
          groupName: group.name,
          beneficiaryName: fullName(requireUser(round.beneficiaryId)),
        };
      }
    }

    return {
      activeGroups: active.length,
      memberCount: active.reduce(
        (sum, group) =>
          sum + new Set(activeMemberships(group.id).map((membership) => membership.userId)).size,
        0,
      ),
      collectedThisMonth: thisMonth?.collected ?? 0,
      expectedThisMonth: thisMonth?.expected ?? 0,
      lateMembers,
      lateAmount,
      nextPayout,
      todo: groups.flatMap(todoFor),
      groups: groups.map((g) => buildOverview(g, user)),
    };
  },

  async superDashboard() {
    await delay();
    synchronize();
    assertSuperAdmin(currentUser());
    const now = new Date();
    const countGroups = (status: GroupStatus) =>
      db.groups.filter((g) => g.status === status).length;
    const members = db.users.filter((u) => u.globalRole === 'user' && !u.deletedAt);
    const admins = db.users.filter((u) => u.globalRole === 'admin' && !u.deletedAt);

    // --- Ponctualité : cotisation par cotisation (un tour × un membre) ---
    let dueCount = 0; // cotisations arrivées à échéance (ou déjà payées)
    let onTimeCount = 0; // … dont payées au plus tard à la date limite
    for (const round of db.rounds) {
      if (round.status === 'upcoming') continue; // tour pas encore ouvert : rien n'est dû
      const dueDate = new Date(round.dueDate);
      for (const { userId } of activeMemberships(round.groupId)) {
        const payment = db.payments.find(
          (p) => p.roundId === round.id && p.userId === userId && p.status === 'paid',
        );
        if (payment) {
          dueCount += 1;
          // Sans date de paiement connue (ancienne saisie), on le considère à l'heure.
          if (!payment.paidAt || new Date(payment.paidAt) <= dueDate) onTimeCount += 1;
        } else if (dueDate < now) {
          dueCount += 1;
        }
      }
    }

    // --- Alertes : échecs du jour, retards par groupe, demandes en attente ---
    const alerts: PlatformAlert[] = [];
    const failedToday = db.payments.filter(
      (p) => p.status === 'failed' && p.createdAt && isToday(new Date(p.createdAt)),
    ).length;
    if (failedToday > 0) {
      alerts.push({
        id: 'failed-today',
        tone: 'danger',
        title: `${plural(failedToday, 'paiement échoué', 'paiements échoués')} aujourd’hui`,
        detail: 'Vérifier avec le service de paiement',
      });
    }
    let lateAmount = 0;
    let lateMembers = 0;
    for (const group of db.groups.filter((g) => g.status === 'active')) {
      const round = currentRoundOf(group.id);
      const late = round ? lateOnRound(group, round, now) : [];
      lateAmount += late.reduce((sum, l) => sum + l.amount, 0);
      lateMembers += late.length;
      if (late.length > 0) {
        alerts.push({
          id: `late-${group.id}`,
          tone: 'warning',
          title: `${group.name} : ${plural(late.length, 'membre')} en retard`,
          detail: `Admin : ${adminNameOf(group)}`,
          link: `/admin/groupes/${group.id}`,
        });
      }
    }
    for (const group of db.groups) {
      const requests = db.memberships.filter(
        (m) => m.groupId === group.id && m.status === 'pending',
      ).length;
      if (requests > 0) {
        alerts.push({
          id: `join-${group.id}`,
          tone: 'info',
          title: `${plural(requests, 'demande', 'demandes')} d’adhésion en attente`,
          detail: `${group.name} · Admin : ${adminNameOf(group)}`,
          link: `/admin/groupes/${group.id}`,
        });
      }
    }

    // Le graphique couvre 6 mois ; le dernier point est le mois en cours.
    const monthly = monthlyCollections(db.rounds, 6, now);
    const thisMonth = monthly.at(-1);

    return {
      groups: {
        total: db.groups.length,
        active: countGroups('active'),
        suspended: countGroups('suspended'),
        finished: countGroups('finished'),
        draft: countGroups('draft'),
      },
      members: members.length,
      newMembersThisMonth: members.filter(
        (u) => u.createdAt && isSameMonth(new Date(u.createdAt), now),
      ).length,
      collectedThisMonth: thisMonth?.collected ?? 0,
      expectedThisMonth: thisMonth?.expected ?? 0,
      onTimeRate: dueCount > 0 ? Math.round((onTimeCount / dueCount) * 100) : null,
      lateAmount,
      lateMembers,
      ...platformHealth(now),
      monthly,
      alerts,
      admins: admins.map((user) => adminPerformance(user, now)),
      transactions: allTransactions().slice(0, 5),
      audit: [...db.auditLog]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 5)
        .map((entry) => {
          const actor = findUser(entry.actorId);
          return { entry, actorName: actor ? fullName(actor) : 'Compte supprimé' };
        }),
    };
  },

  async listTransactions() {
    await delay();
    assertSuperAdmin(currentUser());
    return allTransactions();
  },

  async transactionsPage(filters, cursor, limit) {
    await delay();
    assertSuperAdmin(currentUser());
    const day = (row: TransactionRow) =>
      (row.payment.createdAt ?? row.payment.paidAt ?? '').slice(0, 10);
    const matching = allTransactions().filter(
      (row) =>
        (!filters.status || row.payment.status === filters.status) &&
        (!filters.method || row.payment.method === filters.method) &&
        (!filters.groupId || row.groupId === filters.groupId) &&
        (!filters.from || day(row) >= filters.from) &&
        (!filters.to || day(row) <= filters.to),
    );
    const page = pageOf(
      matching,
      (row) => ({ at: row.payment.createdAt ?? row.payment.paidAt ?? '', id: row.payment.id }),
      cursor,
      limit,
    );
    if (cursor) return page;
    return {
      ...page,
      summary: {
        total: matching.length,
        paidAmount: matching
          .filter((row) => row.payment.status === 'paid')
          .reduce((sum, row) => sum + row.payment.amount, 0),
        openCount: matching.filter((row) => ['pending', 'failed'].includes(row.payment.status))
          .length,
      },
    };
  },

  // --- Administrateurs ---------------------------------------------------------

  async listAdmins() {
    await delay();
    synchronize();
    assertSuperAdmin(currentUser());
    return db.users
      .filter((u) => u.globalRole === 'admin' && !u.deletedAt)
      .map((user) => adminPerformance(user));
  },

  async listAdminChoices() {
    await delay();
    assertAdmin(currentUser());
    return db.users
      .filter((u) => u.globalRole === 'admin' && !u.isSuspended && !u.deletedAt)
      .map((user) => ({ id: user.id, name: fullName(user) }));
  },

  async getAdmin(userId) {
    await delay();
    synchronize();
    assertSuperAdmin(currentUser());
    return adminPerformance(requireAdminTarget(userId));
  },

  async createAdmin(input) {
    const actor = await superAdminAction();
    const phone = normalizePhone(input.phone);
    const existing = db.users.find((u) => u.phone === phone && !u.deletedAt);
    if (existing && existing.globalRole !== 'user') {
      throw new ServiceError('Cette personne est déjà administrateur.', 'conflict');
    }
    let target = existing;
    if (target) {
      // Compte déjà inscrit : il devient administrateur et garde son PIN.
      target.globalRole = 'admin';
    } else {
      // Nouveau compte : à sa 1re connexion, il recevra un code SMS puis créera son PIN.
      target = {
        id: newId('u'),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: checkedPhone(phone),
        globalRole: 'admin',
        isSuspended: false,
        createdAt: nowIso(),
      };
      db.users.push(target);
    }
    recordAudit(actor, 'admin_added', `a nommé ${fullName(target)} administrateur`);
    persist();
  },

  async updateAdmin(userId, input: AccountInput) {
    const actor = await superAdminAction();
    const target = requireAdminTarget(userId);
    const phone = checkedPhone(input.phone, target.id);
    Object.assign(target, {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone,
    });
    recordAudit(actor, 'admin_updated', `a modifié le compte de ${fullName(target)}`);
    persist();
  },

  async suspend(userId) {
    const actor = await superAdminAction();
    const target = requireAdminTarget(userId);
    target.isSuspended = true;
    recordAudit(actor, 'admin_suspended', `a suspendu le compte de ${fullName(target)}`);
    persist();
  },

  async reactivate(userId) {
    const actor = await superAdminAction();
    const target = requireAdminTarget(userId);
    target.isSuspended = false;
    recordAudit(actor, 'admin_reactivated', `a réactivé le compte de ${fullName(target)}`);
    persist();
  },

  async deleteAdmin(userId) {
    const actor = await superAdminAction();
    const target = requireAdminTarget(userId);
    // Un groupe ne doit jamais rester sans administrateur responsable.
    const responsible = db.groups.filter((g) => g.adminId === target.id && !g.archivedAt);
    if (responsible.length > 0) {
      throw new ServiceError(
        `Réattribuez d’abord ses ${plural(responsible.length, 'groupe')} à un autre administrateur.`,
        'conflict',
      );
    }
    target.globalRole = 'user';
    for (const community of db.communities) {
      community.adminIds = community.adminIds.filter((adminId) => adminId !== target.id);
    }
    recordAudit(actor, 'admin_deleted', `a retiré le rôle administrateur à ${fullName(target)}`);
    persist();
  },

  async reassignGroups(fromId, toId) {
    const actor = await superAdminAction();
    const from = requireAdminTarget(fromId);
    const to = requireAdminTarget(toId);
    if (from.id === to.id) throw new ServiceError('Choisissez un autre administrateur.');
    if (to.isSuspended) throw new ServiceError('Cet administrateur est suspendu.');
    const groups = db.groups.filter((g) => g.adminId === from.id);
    for (const group of groups) {
      group.adminId = to.id;
      // L'ancien admin reste membre s'il cotisait, mais perd ses droits de gestion.
      for (const membership of db.memberships) {
        const managed = membership.role === 'owner' || membership.role === 'co_admin';
        if (membership.groupId === group.id && membership.userId === from.id && managed) {
          membership.role = 'member';
        }
      }
    }
    notify(
      to.id,
      'admin',
      'Nouveaux groupes à gérer',
      `${plural(groups.length, 'groupe vous a été confié', 'groupes vous ont été confiés')} par le super administrateur.`,
      '/admin',
    );
    recordAudit(
      actor,
      'groups_reassigned',
      `a confié les ${plural(groups.length, 'groupe')} de ${fullName(from)} à ${fullName(to)}`,
    );
    persist();
    return groups.length;
  },

  async listCommunities() {
    await delay();
    const user = currentUser();
    assertAdmin(user);
    return db.communities
      .filter(
        (community) => user.globalRole === 'super_admin' || community.adminIds.includes(user.id),
      )
      .map((community) => ({
        ...community,
        adminIds: [...community.adminIds],
      }));
  },

  async saveCommunity(input: SaveCommunityInput) {
    const actor = await superAdminAction();
    const name = input.name.trim();
    const description = input.description?.trim() || undefined;
    const adminIds = [...new Set(input.adminIds)];
    if (name.length < 2 || name.length > 60) {
      throw new ServiceError('Le nom doit contenir entre 2 et 60 caractères.');
    }
    if ((description?.length ?? 0) > 300) {
      throw new ServiceError('La description ne peut pas dépasser 300 caractères.');
    }
    if (adminIds.length === 0) {
      throw new ServiceError('Affectez au moins un administrateur à cette communauté.');
    }
    for (const adminId of adminIds) {
      const admin = requireAdminTarget(adminId);
      if (admin.isSuspended || admin.deletedAt) {
        throw new ServiceError('Une communauté ne peut être confiée qu’à des admins actifs.');
      }
    }
    if (
      db.communities.some(
        (community) =>
          community.id !== input.id &&
          community.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      throw new ServiceError('Une communauté porte déjà ce nom.', 'conflict');
    }

    let community: Community;
    if (input.id) {
      const existing = db.communities.find((item) => item.id === input.id);
      if (!existing) throw new ServiceError('Cette communauté est introuvable.', 'not_found');
      // Retirer un admin de la communauté ne touche pas aux groupes dont il est
      // l'admin : les deux rôles sont indépendants.
      const newlyAssigned = adminIds.filter((adminId) => !existing.adminIds.includes(adminId));
      Object.assign(existing, { name, description, adminIds });
      community = existing;
      recordAudit(actor, 'community_updated', `a modifié la communauté « ${name} »`);
      for (const adminId of newlyAssigned) {
        notify(
          adminId,
          'community',
          'Nouvelle communauté',
          `Vous avez été affecté à la communauté « ${name} ».`,
          '/admin/mes-groupes',
        );
      }
    } else {
      community = {
        id: newId('community'),
        name,
        description,
        adminIds,
        createdAt: nowIso(),
      };
      db.communities.push(community);
      recordAudit(actor, 'community_created', `a créé la communauté « ${name} »`);
      for (const adminId of adminIds) {
        notify(
          adminId,
          'community',
          'Nouvelle communauté',
          `Vous avez été affecté à la communauté « ${name} ».`,
          '/admin/mes-groupes',
        );
      }
    }
    persist();
    return { ...community, adminIds: [...community.adminIds] };
  },

  // --- Supervision des groupes -------------------------------------------------

  async suspendGroup(groupId) {
    const actor = await superAdminAction();
    const group = requireGroup(groupId);
    if (group.status === 'suspended') throw new ServiceError('Ce groupe est déjà suspendu.');
    if (group.status === 'finished') throw new ServiceError('Ce groupe est déjà clôturé.');
    group.status = 'suspended';
    notifyManagers(
      group.id,
      'admin',
      'Groupe suspendu',
      `${group.name} est suspendu par l’administration : paiements et versements sont gelés.`,
    );
    recordAudit(actor, 'group_suspended', `a suspendu le groupe « ${group.name} »`, group.id);
    persist();
  },

  async reactivateGroup(groupId) {
    const actor = await superAdminAction();
    const group = requireGroup(groupId);
    if (group.status !== 'suspended') throw new ServiceError('Ce groupe n’est pas suspendu.');
    // Un groupe qui avait déjà démarré (des tours existent) reprend son cours ; sinon brouillon.
    group.status = db.rounds.some((r) => r.groupId === group.id) ? 'active' : 'draft';
    notifyManagers(group.id, 'admin', 'Groupe réactivé', `${group.name} est de nouveau actif.`);
    recordAudit(actor, 'group_reactivated', `a réactivé le groupe « ${group.name} »`, group.id);
    persist();
  },

  async closeGroup(groupId) {
    const actor = await superAdminAction();
    const group = requireGroup(groupId);
    if (group.status === 'finished') throw new ServiceError('Ce groupe est déjà clôturé.');
    group.status = 'finished';
    notifyManagers(
      group.id,
      'admin',
      'Groupe clôturé',
      `${group.name} a été clôturé par l’administration de la plateforme.`,
    );
    recordAudit(actor, 'group_closed', `a clôturé le groupe « ${group.name} »`, group.id);
    persist();
  },

  async archiveGroup(groupId) {
    const actor = await superAdminAction();
    const group = requireGroup(groupId);
    if (group.status !== 'finished') {
      throw new ServiceError('Seul un groupe terminé ou clôturé peut être archivé.');
    }
    group.archivedAt = nowIso();
    recordAudit(actor, 'group_archived', `a archivé le groupe « ${group.name} »`, group.id);
    persist();
  },

  async changeGroupAdmin(groupId, adminId) {
    const actor = await superAdminAction();
    const group = requireGroup(groupId);
    const admin = requireAdminTarget(adminId);
    if (admin.isSuspended) throw new ServiceError('Cet administrateur est suspendu.');
    const previous = findUser(group.adminId);
    group.adminId = admin.id;
    // L'ancien responsable perd ses droits de gestion (il reste membre s'il cotise).
    for (const membership of db.memberships) {
      const managed = membership.role === 'owner' || membership.role === 'co_admin';
      if (membership.groupId === group.id && membership.userId === previous?.id && managed) {
        membership.role = 'member';
      }
    }
    notify(
      admin.id,
      'admin',
      'Nouveau groupe à gérer',
      `Vous gérez désormais ${group.name}.`,
      `/admin/groupes/${group.id}`,
    );
    recordAudit(
      actor,
      'group_admin_changed',
      `a confié le groupe « ${group.name} » à ${fullName(admin)}`,
      group.id,
    );
    persist();
  },

  async transferGroup(groupId, communityId, adminId) {
    const actor = await superAdminAction();
    const group = requireGroup(groupId);
    const community = db.communities.find((item) => item.id === communityId);
    if (!community) throw new ServiceError('Choisissez une communauté existante.');
    const admin = requireAdminTarget(adminId);
    if (admin.isSuspended || admin.deletedAt) {
      throw new ServiceError('Choisissez un administrateur actif.');
    }

    const previousAdminId = group.adminId;
    const previousCommunityId = group.communityId;
    group.communityId = community.id;
    group.adminId = admin.id;
    for (const membership of db.memberships) {
      if (membership.groupId !== group.id || membership.userId !== previousAdminId) continue;
      if (membership.role === 'owner' || membership.role === 'co_admin') {
        membership.role = 'member';
      }
    }
    for (const membership of db.memberships.filter(
      (item) => item.groupId === group.id && item.status === 'active',
    )) {
      notify(
        membership.userId,
        'community',
        'Communauté du groupe modifiée',
        `« ${group.name} » appartient maintenant à la communauté « ${community.name} ».`,
        `/groupes/${group.id}`,
      );
    }
    notify(
      admin.id,
      'admin',
      'Groupe transféré',
      `Vous êtes maintenant responsable de « ${group.name} » dans la communauté « ${community.name} ».`,
      `/admin/groupes/${group.id}`,
    );
    if (previousAdminId !== admin.id) {
      notify(
        previousAdminId,
        'admin',
        'Groupe transféré',
        `La gestion de « ${group.name} » a été transférée à ${fullName(admin)}.`,
        '/admin/mes-groupes',
      );
    }
    recordAudit(
      actor,
      'group_community_changed',
      `a transféré « ${group.name} »${previousCommunityId ? ' vers' : ' dans'} la communauté « ${community.name} » et l’a confié à ${fullName(admin)}`,
      group.id,
    );
    persist();
  },
};
