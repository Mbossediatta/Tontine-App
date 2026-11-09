// Période de service de la plateforme : chaque membre y paie la part réglée d'une cotisation
// (50 % par défaut), figée à la création du groupe ; le super admin la règle.
import {
  authService,
  groupService,
  membershipService,
  roundService,
  settingsService,
} from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import { resetDatabase } from '@/services/mock/db';

const MOUSSA = 'u-admin1';

async function startedGroup() {
  await demoLogin(MOUSSA);
  const group = await groupService.create({
    communityId: 'c-ouakam',
    name: 'Tontine avec période de service',
    contributionAmount: 10000,
    frequency: 'monthly',
    turnLength: 1,
    maxMembers: 2,
    paymentDueDay: 1,
    startDate: new Date(Date.now() + 86_400_000).toISOString(),
    attributionMode: 'manual',
    reserveFinalTurn: true,
  });
  await membershipService.addByPhone(group.id, '772345678');
  const members = (await membershipService.list(group.id)).filter(
    (member) => member.membership.status === 'active',
  );
  await roundService.setManualOrder(
    group.id,
    members.map((member) => member.membership.id),
  );
  await groupService.start(group.id);
  return group.id;
}

describe('période de service de la plateforme', () => {
  beforeEach(async () => {
    resetDatabase();
    await authService.logout();
  });

  it('vaut la moitié d’une cagnotte par défaut', async () => {
    const groupId = await startedGroup();
    const rounds = await roundService.list(groupId);
    const pots = rounds.map(({ round }) => [round.recipientType, round.potAmount]);
    expect(pots).toEqual([
      ['members', 20000],
      ['members', 20000],
      ['platform', 10000],
    ]);
  }, 20_000);

  it('suit le réglage du super admin pour les groupes créés ensuite', async () => {
    await demoLogin('u-super');
    const settings = await settingsService.get();
    await expect(
      settingsService.update('rules', { ...settings.rules, platformSharePercent: 5 }),
    ).rejects.toThrow(/entre 10 et 100/);
    await settingsService.update('rules', { ...settings.rules, platformSharePercent: 30 });

    const groupId = await startedGroup();
    const platform = (await roundService.list(groupId)).find(
      ({ round }) => round.recipientType === 'platform',
    );
    expect(platform?.round.potAmount).toBe(6000);
  }, 20_000);
});
