// Garde-fou : un super admin membre d'un groupe ne décide pas sur son propre argent
// (sa cagnotte, son paiement, sa réclamation) ; l'administrateur du groupe le fait.
import {
  authService,
  disputeService,
  groupService,
  membershipService,
  paymentService,
  roundService,
} from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import { findUser, resetDatabase } from '@/services/mock/db';

const MOUSSA = 'u-admin1';
const SUPER = 'u-super';

/** Groupe de deux parts : l'admin Moussa et le super admin, qui reçoit au tour 1. */
async function groupWithSuperAdminFirst() {
  await demoLogin(MOUSSA);
  const group = await groupService.create({
    communityId: 'c-ouakam',
    name: 'Tontine du garde-fou',
    contributionAmount: 1000,
    frequency: 'monthly',
    turnLength: 1,
    maxMembers: 2,
    paymentDueDay: 1,
    startDate: new Date(Date.now() + 86_400_000).toISOString(),
    attributionMode: 'manual',
  });
  const superAdmin = findUser(SUPER);
  if (!superAdmin) throw new Error('Compte super admin absent de la démo');
  // Numéro où il reçoit sa cagnotte (nécessaire au versement).
  superAdmin.payoutPhone = '771112233';
  superAdmin.payoutMethod = 'wave';
  await membershipService.addByPhone(group.id, superAdmin.phone);
  const members = (await membershipService.list(group.id)).filter(
    (member) => member.membership.status === 'active',
  );
  const order = [
    ...members.filter((member) => member.user.id === SUPER),
    ...members.filter((member) => member.user.id !== SUPER),
  ];
  await roundService.setManualOrder(
    group.id,
    order.map((member) => member.membership.id),
  );
  await groupService.start(group.id);
  const roundId = (await groupService.get(group.id)).currentRound?.id ?? '';
  return { groupId: group.id, roundId };
}

describe('garde-fou du super admin', () => {
  beforeEach(async () => {
    resetDatabase();
    await authService.logout();
  });

  it('refuse qu’il enregistre son propre paiement, accepte celui d’un autre membre', async () => {
    const { roundId } = await groupWithSuperAdminFirst();
    await demoLogin(SUPER);
    await expect(paymentService.recordCash(roundId, SUPER)).rejects.toThrow(
      /administrateur du groupe/,
    );
    await expect(paymentService.recordCash(roundId, MOUSSA)).resolves.toBeUndefined();
  }, 20_000);

  it('refuse qu’il valide sa propre cagnotte ; l’admin du groupe le peut', async () => {
    const { roundId } = await groupWithSuperAdminFirst();
    await paymentService.recordCash(roundId, MOUSSA);
    await paymentService.recordCash(roundId, SUPER);

    await demoLogin(SUPER);
    await expect(roundService.payout(roundId)).rejects.toThrow(/bénéficiaire de ce tour/);

    await demoLogin(MOUSSA);
    await expect(roundService.payout(roundId)).resolves.not.toThrow();
  }, 20_000);

  it('refuse qu’il ouvre une réclamation : c’est lui qui les traite', async () => {
    const { groupId, roundId } = await groupWithSuperAdminFirst();
    await demoLogin(SUPER);
    await expect(
      disputeService.open({
        groupId,
        roundId,
        kind: 'debited_not_recorded',
        amount: 1000,
        description: 'Paiement fait mais non enregistré',
      }),
    ).rejects.toThrow(/traitez les réclamations/);
  }, 20_000);
});
