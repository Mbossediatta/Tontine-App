// Denthie (« garderie ») : épargne par période, date de répartition fixée plus tard,
// répartition finale et retrait d'urgence (mêmes règles que la migration …_denthie.sql).
import { subDays } from 'date-fns';
import {
  authService,
  groupService,
  membershipService,
  paymentService,
  roundService,
} from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import { synchronize } from '@/services/mock/clock';
import { db, persist, resetDatabase } from '@/services/mock/db';

const MOUSSA = 'u-admin1';
const DAY = 86_400_000;

async function startedDenthie() {
  await demoLogin(MOUSSA);
  const group = await groupService.create({
    kind: 'denthie',
    communityId: 'c-ouakam',
    name: 'Denthie Famille',
    contributionAmount: 10000,
    frequency: 'monthly',
    turnLength: 6,
    sharesPerRound: 3,
    reserveFinalTurn: true,
    maxMembers: 10,
    paymentDueDay: 5,
    startDate: new Date(Date.now() + DAY).toISOString(),
    attributionMode: 'random',
  });
  await membershipService.addByPhone(group.id, '772345678');
  const other = (await membershipService.list(group.id)).find(
    (member) => member.membership.status === 'active' && member.user.id !== MOUSSA,
  );
  for (const user of db.users) if (!user.payoutPhone) user.payoutPhone = user.phone;
  persist();
  await groupService.start(group.id);
  return { groupId: group.id, otherId: other?.user.id ?? '' };
}

/** Fait comme si l'heure limite de la période en cours était passée. */
function passDeadline(groupId: string) {
  const round = db.rounds.find((r) => r.groupId === groupId && r.status !== 'paid_out');
  if (round) round.dueDate = subDays(new Date(), 2).toISOString();
  synchronize();
}

describe('Denthie', () => {
  beforeEach(async () => {
    resetDatabase();
    await authService.logout();
  });

  it('garde des règles fixes : une période à la fois, sans bénéficiaire ni période de service', async () => {
    const { groupId } = await startedDenthie();
    const overview = await groupService.get(groupId);
    expect(overview.group).toMatchObject({
      kind: 'denthie',
      turnLength: 1,
      sharesPerRound: 1,
      reserveFinalTurn: false,
      latePenalty: 250,
      maxMembers: 2,
    });
    const rounds = await roundService.list(groupId);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.round).toMatchObject({ purpose: 'turn', status: 'open', potAmount: 20000 });
    await expect(roundService.payout(rounds[0]?.round.id ?? '')).rejects.toThrow(
      /reste dans la caisse/,
    );
  }, 20_000);

  it('donne une seule épargne par membre (pas de parts)', async () => {
    await demoLogin(MOUSSA);
    const group = await groupService.create({
      kind: 'denthie',
      communityId: 'c-ouakam',
      name: 'Denthie sans parts',
      contributionAmount: 5000,
      frequency: 'weekly',
      turnLength: 1,
      maxMembers: 5,
      paymentDueDay: 5,
      startDate: new Date(Date.now() + DAY).toISOString(),
      attributionMode: 'manual',
    });
    await expect(membershipService.addByPhone(group.id, '772345678', 2)).rejects.toThrow(
      /une seule épargne/,
    );
    await membershipService.addByPhone(group.id, '772345678', 1);
    await expect(membershipService.addByPhone(group.id, '772345678', 1)).rejects.toThrow(
      /une seule épargne/,
    );
  }, 20_000);

  it('enchaîne les périodes, applique la pénalité et répartit l’épargne de chacun', async () => {
    const { groupId, otherId } = await startedDenthie();
    const first = (await roundService.list(groupId))[0]?.round.id ?? '';
    await paymentService.recordCash(first, MOUSSA);
    await paymentService.recordCash(first, otherId);

    // Période 1 close, période 2 ouverte ; seul Moussa cotise : l'autre a la pénalité.
    passDeadline(groupId);
    const second = (await roundService.list(groupId)).find((v) => v.round.status === 'open');
    expect(second).toBeDefined();
    await paymentService.recordCash(second?.round.id ?? '', MOUSSA);
    passDeadline(groupId);
    expect(db.debts.find((d) => d.userId === otherId)).toMatchObject({
      amount: 0,
      penaltyAmount: 250,
    });

    const overview = await groupService.get(groupId);
    expect(overview.savings?.byUser).toEqual({ [MOUSSA]: 20000, [otherId]: 10000 });

    // Carnet : l'admin lit les versements d'un membre ; un membre ne lit pas ceux d'un autre.
    expect(await paymentService.listMemberPayments(groupId, otherId)).toHaveLength(1);
    await demoLogin(otherId);
    await expect(paymentService.listMemberPayments(groupId, MOUSSA)).rejects.toThrow();
    expect(await paymentService.listMemberPayments(groupId, otherId)).toHaveLength(1);
    await demoLogin(MOUSSA);

    // La date se fixe plus tard ; la répartition attend cette date.
    await groupService.setEndDate(
      groupId,
      new Date(Date.now() + 120 * DAY).toISOString().slice(0, 10),
    );
    await expect(groupService.distribute(groupId)).rejects.toThrow(/à partir du/);
    const group = db.groups.find((g) => g.id === groupId);
    if (group) group.endDate = subDays(new Date(), 1).toISOString();
    persist();

    expect(await groupService.distribute(groupId)).toBe('paid');
    const distribution = (await roundService.list(groupId)).find(
      (v) => v.round.purpose === 'distribution',
    );
    // L'autre membre récupère ses 10 000 FCFA moins sa pénalité non réglée.
    expect(distribution?.round.beneficiaryAmounts).toEqual({ [MOUSSA]: 20000, [otherId]: 9750 });
    expect((await groupService.get(groupId)).group.status).toBe('finished');
  }, 30_000);

  it('accorde un retrait d’urgence : le membre reçoit son épargne et quitte le Denthie', async () => {
    const { groupId, otherId } = await startedDenthie();
    const first = (await roundService.list(groupId))[0]?.round.id ?? '';
    await paymentService.recordCash(first, otherId);

    await demoLogin(otherId);
    await groupService.requestWithdrawal(groupId, 'Hospitalisation');
    await expect(groupService.requestWithdrawal(groupId, 'Encore')).rejects.toThrow(/déjà/);

    await demoLogin(MOUSSA);
    await groupService.withdraw(groupId, otherId, 'Hospitalisation');
    const withdrawal = (await roundService.list(groupId)).find(
      (v) => v.round.purpose === 'withdrawal',
    );
    expect(withdrawal?.round.beneficiaryAmounts).toEqual({ [otherId]: 10000 });
    const overview = await groupService.get(groupId);
    expect(overview.activeMemberCount).toBe(1);
    expect(overview.currentRound?.potAmount).toBe(10000);
  }, 30_000);
});
