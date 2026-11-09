import {
  addDays,
  startOfMonth,
  startOfWeek,
  subDays,
  subHours,
  subMinutes,
  subMonths,
  subWeeks,
} from 'date-fns';
import { computeDueDate, computePot, roundOpenDate } from '@/lib/tontine';
import type { Group, Membership, Payment, PaymentMethod, Penalty, Round } from '@/types';

export interface GroupSeed {
  groups: Group[];
  memberships: Membership[];
  rounds: Round[];
  payments: Payment[];
  penalties: Penalty[];
}

const METHODS: PaymentMethod[] = ['wave', 'orange_money', 'free_money', 'wave', 'cash'];

function membership(
  groupId: string,
  userId: string,
  role: Membership['role'],
  payoutOrder: number | undefined,
  joinedAt: Date,
  status: Membership['status'] = 'active',
): Membership {
  return {
    id: `m-${groupId}-${userId}`,
    groupId,
    userId,
    role,
    status,
    payoutOrder,
    joinedAt: joinedAt.toISOString(),
  };
}

function buildRounds(group: Group, orderedUserIds: string[], openRoundIndex: number): Round[] {
  const start = new Date(group.startDate);
  return orderedUserIds.map((userId, index) => {
    const openDate = roundOpenDate(start, group.frequency, index);
    const dueDate = computeDueDate(
      openDate,
      group.frequency,
      group.paymentDueDay,
      group.turnLength,
    );
    const status: Round['status'] =
      index < openRoundIndex ? 'paid_out' : index === openRoundIndex ? 'open' : 'upcoming';
    return {
      id: `r-${group.id}-${index + 1}`,
      groupId: group.id,
      number: index + 1,
      openDate: openDate.toISOString(),
      dueDate: dueDate.toISOString(),
      beneficiaryId: userId,
      potAmount: computePot(group.contributionAmount, orderedUserIds.length),
      status,
      paidOutAt: status === 'paid_out' ? addDays(dueDate, 1).toISOString() : undefined,
      cycle: 1,
    };
  });
}

function paidPayment(round: Round, userId: string, amount: number, index: number): Payment {
  const method = METHODS[index % METHODS.length] ?? 'wave';
  const paidAt = addDays(new Date(round.openDate), (index % 5) + 1).toISOString();
  return {
    id: `p-${round.id}-${userId}`,
    roundId: round.id,
    userId,
    amount,
    method,
    providerRef:
      method === 'cash' ? undefined : `PD-${round.number}${index}${userId.length}7${index}`,
    status: 'paid',
    paidAt,
    createdAt: paidAt,
  };
}

export function seedGroups(now: Date = new Date()): GroupSeed {
  // « Tontine Famille » : 10 membres, mensuelle, tour 3 en cours.
  const familleStart = startOfMonth(subMonths(now, 2));
  const famille: Group = {
    id: 'g-famille',
    name: 'Tontine Famille',
    description: 'La tontine mensuelle de la famille Diop et de leurs proches.',
    contributionAmount: 4500,
    frequency: 'monthly',
    turnLength: 1,
    maxMembers: 10,
    paymentDueDay: 10,
    startDate: familleStart.toISOString(),
    attributionMode: 'random',
    latePenalty: 500,
    status: 'active',
    inviteCode: 'FAM4K7',
    createdBy: 'u-admin1',
    adminId: 'u-admin1',
    currentCycle: 1,
  };
  const familleOrder = [
    'u-p4',
    'u-p7',
    'u-p3',
    'u-p1',
    'u-p5',
    'u-admin1',
    'u-p2',
    'u-p6',
    'u-p8',
    'u-p9',
  ];
  const familleRounds = buildRounds(famille, familleOrder, 2);
  const current = familleRounds[2];
  if (current) current.dueDate = addDays(now, 6).toISOString();

  // « Collègues du bureau » : brouillon, 5 membres sur 6 et une demande en attente.
  const bureau: Group = {
    id: 'g-bureau',
    name: 'Collègues du bureau',
    description: 'Cotisation entre collègues, démarrage le mois prochain.',
    contributionAmount: 10000,
    frequency: 'monthly',
    turnLength: 1,
    maxMembers: 6,
    paymentDueDay: 5,
    startDate: startOfMonth(subMonths(now, -1)).toISOString(),
    attributionMode: 'random',
    status: 'draft',
    inviteCode: 'BUR92X',
    createdBy: 'u-admin2',
    adminId: 'u-admin2',
    currentCycle: 1,
  };

  // « Amies du quartier » : hebdomadaire, 8 membres, terminée.
  const amiesStart = startOfWeek(subWeeks(now, 12), { weekStartsOn: 1 });
  const amies: Group = {
    id: 'g-amies',
    name: 'Amies du quartier',
    description: 'Petite tontine hebdomadaire entre voisines.',
    contributionAmount: 2000,
    frequency: 'weekly',
    turnLength: 1,
    maxMembers: 8,
    paymentDueDay: 5,
    startDate: amiesStart.toISOString(),
    attributionMode: 'manual',
    status: 'finished',
    inviteCode: 'AMI3Q8',
    createdBy: 'u-admin1',
    adminId: 'u-admin1',
    currentCycle: 1,
  };
  const amiesOrder = ['u-p3', 'u-p5', 'u-p7', 'u-p9', 'u-p1', 'u-admin1', 'u-p11', 'u-p6'];
  const amiesRounds = buildRounds(amies, amiesOrder, amiesOrder.length);

  // « Tontine Thiaroye » (Fatou Ndiaye) : mensuelle, 6 membres, démarrée il y a 5 mois.
  // Tours 1 à 5 versés, tour 6 en cours : de l'historique pour le graphique sur 6 mois.
  const thiaroye: Group = {
    id: 'g-thiaroye',
    name: 'Tontine Thiaroye',
    description: 'Tontine des commerçantes du marché de Thiaroye.',
    contributionAmount: 10000,
    frequency: 'monthly',
    turnLength: 1,
    maxMembers: 6,
    paymentDueDay: 5,
    startDate: startOfMonth(subMonths(now, 5)).toISOString(),
    attributionMode: 'manual',
    latePenalty: 1000,
    status: 'active',
    inviteCode: 'THI7P2',
    createdBy: 'u-admin2',
    adminId: 'u-admin2',
    currentCycle: 1,
  };
  const thiaroyeOrder = ['u-p10', 'u-p6', 'u-admin2', 'u-p11', 'u-p8', 'u-p4'];
  const thiaroyeRounds = buildRounds(thiaroye, thiaroyeOrder, 5);
  const thiaroyeCurrent = thiaroyeRounds[5];
  if (thiaroyeCurrent) thiaroyeCurrent.dueDate = addDays(now, 2).toISOString();

  // « Entraide Pikine » : suspendue par le super administrateur, aucun tour.
  const pikine: Group = {
    id: 'g-pikine',
    name: 'Entraide Pikine',
    description: 'Groupe suspendu en attendant la vérification des membres.',
    contributionAmount: 5000,
    frequency: 'monthly',
    turnLength: 1,
    maxMembers: 10,
    paymentDueDay: 10,
    startDate: startOfMonth(subMonths(now, 1)).toISOString(),
    attributionMode: 'random',
    status: 'suspended',
    inviteCode: 'PIK5N1',
    createdBy: 'u-admin2',
    adminId: 'u-admin2',
    currentCycle: 1,
  };

  const joined = subMonths(now, 3);
  const memberships: Membership[] = [
    ...familleOrder.map((userId, index) =>
      membership(
        famille.id,
        userId,
        userId === 'u-admin1' ? 'owner' : userId === 'u-p2' ? 'co_admin' : 'member',
        index + 1,
        joined,
      ),
    ),
    membership(bureau.id, 'u-admin2', 'owner', undefined, joined),
    membership(bureau.id, 'u-admin1', 'co_admin', undefined, joined),
    membership(bureau.id, 'u-p1', 'member', undefined, joined),
    membership(bureau.id, 'u-p10', 'member', undefined, joined),
    membership(bureau.id, 'u-p11', 'member', undefined, joined),
    membership(bureau.id, 'u-p12', 'member', undefined, subWeeks(now, 0), 'pending'),
    ...thiaroyeOrder.map((userId, index) =>
      membership(
        thiaroye.id,
        userId,
        userId === 'u-admin2' ? 'owner' : 'member',
        index + 1,
        subMonths(now, 6),
      ),
    ),
    membership(pikine.id, 'u-admin2', 'owner', undefined, joined),
    membership(pikine.id, 'u-p5', 'member', undefined, joined),
    membership(pikine.id, 'u-p7', 'member', undefined, joined),
    ...amiesOrder.map((userId, index) =>
      membership(
        amies.id,
        userId,
        userId === 'u-admin1' ? 'owner' : userId === 'u-p3' ? 'co_admin' : 'member',
        index + 1,
        subWeeks(now, 14),
      ),
    ),
  ];

  const payments: Payment[] = [];
  const penalties: Penalty[] = [];
  // Tours déjà versés : tout le monde a payé (parfois après la date limite).
  const histories = [
    { group: famille, order: familleOrder, rounds: familleRounds },
    { group: amies, order: amiesOrder, rounds: amiesRounds },
    { group: thiaroye, order: thiaroyeOrder, rounds: thiaroyeRounds },
  ];
  for (const { group, order, rounds } of histories) {
    for (const round of rounds) {
      if (round.status !== 'paid_out') continue;
      order.forEach((userId, index) =>
        payments.push(paidPayment(round, userId, group.contributionAmount, index + round.number)),
      );
    }
  }
  if (thiaroyeCurrent) {
    // Tour en cours de Thiaroye : 3 payés, un paiement échoué ce matin, un en attente
    // de confirmation par l'agrégateur, et Cheikh Mbaye (u-p4) qui n'a rien tenté.
    ['u-p6', 'u-admin2', 'u-p8'].forEach((userId, index) =>
      payments.push(paidPayment(thiaroyeCurrent, userId, thiaroye.contributionAmount, index)),
    );
    payments.push({
      id: `p-${thiaroyeCurrent.id}-u-p10`,
      roundId: thiaroyeCurrent.id,
      userId: 'u-p10',
      amount: thiaroye.contributionAmount,
      method: 'orange_money',
      providerRef: 'PD-60917',
      status: 'failed',
      createdAt: subHours(now, 2).toISOString(),
    });
    payments.push({
      id: `p-${thiaroyeCurrent.id}-u-p11`,
      roundId: thiaroyeCurrent.id,
      userId: 'u-p11',
      amount: thiaroye.contributionAmount,
      method: 'wave',
      providerRef: 'PD-60918',
      status: 'pending',
      createdAt: subMinutes(now, 30).toISOString(),
    });
  }
  if (current) {
    // Tour en cours : 7 payés, 2 en retard, Awa Fall (u-p1) en attente.
    ['u-admin1', 'u-p2', 'u-p3', 'u-p4', 'u-p5', 'u-p6', 'u-p8'].forEach((userId, index) =>
      payments.push(paidPayment(current, userId, famille.contributionAmount, index)),
    );
    // Deux membres déjà en retard : la pénalité leur a été appliquée d'office.
    for (const userId of ['u-p7', 'u-p9']) {
      penalties.push({
        id: `pen-${current.id}-${userId}`,
        roundId: current.id,
        userId,
        amount: famille.latePenalty ?? 0,
        appliedAt: subDays(now, 1).toISOString(),
      });
    }
  }

  // Double paiement de Khady Ba (u-p3) sur le tour en cours de « Tontine Famille »
  // (objet d'un litige en cours de traitement).
  if (current) {
    const original = payments.find((p) => p.roundId === current.id && p.userId === 'u-p3');
    if (original) payments.push({ ...original, id: 'p-dup-u-p3', providerRef: 'PD-DUP-302' });
  }

  // Un paiement du tour en cours ne peut pas être daté dans le futur : on le ramène
  // à quelques heures avant maintenant (début de mois, tour ouvert depuis peu).
  payments
    .filter((p) => p.paidAt && new Date(p.paidAt) > now)
    .forEach((p, index) => {
      p.paidAt = subHours(now, 3 + index * 5).toISOString();
      p.createdAt = p.paidAt;
    });

  // Les versements déjà faits ont été validés par l'administrateur du groupe.
  const groupsById = new Map([famille, bureau, amies, thiaroye, pikine].map((g) => [g.id, g]));
  for (const round of [...familleRounds, ...amiesRounds, ...thiaroyeRounds]) {
    if (round.status === 'paid_out')
      round.payoutValidatedBy = groupsById.get(round.groupId)?.adminId;
  }

  return {
    // Période de service : le réglage par défaut (50 %), comme les groupes en ligne.
    groups: [famille, bureau, amies, thiaroye, pikine].map((group) => ({
      ...group,
      platformSharePercent: 50,
    })),
    memberships,
    rounds: [...familleRounds, ...amiesRounds, ...thiaroyeRounds],
    payments,
    penalties,
  };
}
