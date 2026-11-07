// Back-office du super administrateur : administrateurs, supervision des groupes, membres.
import {
  adminService,
  authService,
  financeService,
  groupService,
  memberService,
  membershipService,
  paymentService,
  reportService,
  roundService,
  swapService,
} from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import { simulateDeadlinePassed } from '@/services/mock/clock';
import { applyPendingConfirmations, completeSimulatedCheckout } from '@/services/mock/gateway';
import { lastOtpFor } from '@/services/mock/otp';
import { resetDatabase } from '@/services/mock/db';
import { duesOf } from '@/features/member/dues';

const FATOU = 'u-admin2';
const MOUSSA = 'u-admin1';

describe('back-office du super administrateur', () => {
  beforeEach(async () => {
    resetDatabase();
    await demoLogin('u-super');
  });

  it('crée un admin sans compte : il devra passer par le SMS puis créer son PIN', async () => {
    await adminService.createAdmin({ firstName: 'Rama', lastName: 'Diouf', phone: '776001122' });
    const created = (await adminService.listAdmins()).find((a) => a.user.phone === '776001122');
    expect(created?.pinPending).toBe(true);
    // Après le code SMS, le compte existe mais n'a pas de PIN : il devra en créer un.
    await authService.sendOtp('776001122');
    expect(await authService.verifyOtp('776001122', lastOtpFor('776001122') ?? '')).toMatchObject({
      isNewAccount: false,
      hasPin: false,
    });
  }, 10_000);

  it('affecte plusieurs admins à une communauté et retire les accès après réattribution', async () => {
    const community = await adminService.saveCommunity({
      name: 'Association Soleil',
      description: 'Les groupes de l’association.',
      adminIds: [MOUSSA, FATOU],
    });
    const group = await groupService.create({
      communityId: community.id,
      name: 'Tontine Soleil',
      contributionAmount: 2500,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 4,
      paymentDueDay: 5,
      startDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      attributionMode: 'random',
      adminId: MOUSSA,
    });

    await demoLogin(FATOU);
    expect((await adminService.listCommunities()).map((item) => item.id)).toContain(community.id);
    expect((await groupService.listManaged()).map((item) => item.group.id)).not.toContain(group.id);
    await expect(groupService.get(group.id)).rejects.toThrow(/ne faites pas partie/);

    // Retiré de la communauté, Moussa reste l'admin de son groupe : les rôles sont indépendants.
    await demoLogin('u-super');
    await adminService.saveCommunity({
      ...community,
      adminIds: [FATOU],
    });
    await demoLogin(MOUSSA);
    expect((await adminService.listCommunities()).map((item) => item.name)).not.toContain(
      'Association Soleil',
    );
    expect((await groupService.get(group.id)).canManage).toBe(true);

    await demoLogin('u-super');
    await adminService.changeGroupAdmin(group.id, FATOU);
    await demoLogin(MOUSSA);
    await expect(groupService.get(group.id)).rejects.toThrow();

    await demoLogin(FATOU);
    expect((await adminService.listCommunities()).map((item) => item.name)).toContain(
      'Association Soleil',
    );
    expect((await groupService.listManaged()).map((item) => item.group.id)).toContain(group.id);
  }, 15_000);

  it('refuse de supprimer un admin qui a encore des groupes, puis accepte après réattribution', async () => {
    await expect(adminService.deleteAdmin(FATOU)).rejects.toThrow(/Réattribuez/);
    const moved = await adminService.reassignGroups(FATOU, MOUSSA);
    expect(moved).toBe(3);
    await adminService.deleteAdmin(FATOU);
    expect((await adminService.listAdmins()).map((a) => a.user.id)).not.toContain(FATOU);
  }, 15_000);

  it('le nouvel admin d’un groupe peut le gérer sans y cotiser ni être admin de la communauté', async () => {
    // Fatou n'est pas admin de Ouakam, la communauté de « g-famille ».
    await adminService.changeGroupAdmin('g-famille', FATOU);
    await demoLogin(FATOU);
    const famille = await groupService.get('g-famille');
    expect(famille.canManage).toBe(true);
    expect(famille.myRole).toBeUndefined(); // il n'en est pas membre
    expect((await adminService.listCommunities()).map((item) => item.id)).not.toContain('c-ouakam');
  }, 10_000);

  it('confie un nouveau groupe à un admin extérieur à la communauté', async () => {
    const group = await groupService.create({
      communityId: 'c-ouakam',
      name: 'Tontine Extérieure',
      contributionAmount: 2500,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 4,
      paymentDueDay: 5,
      startDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      attributionMode: 'random',
      adminId: FATOU,
    });
    expect(group.communityId).toBe('c-ouakam');
    expect(group.adminId).toBe(FATOU);

    // L'admin confié gère sans cotiser ; « Je participe » l'inscrit sans code.
    await demoLogin(FATOU);
    const before = await groupService.get(group.id);
    expect(before.myMembershipStatus).toBeUndefined();
    const { user } = await authService.getSession();
    await membershipService.addByPhone(group.id, user?.phone ?? '', 1);
    expect((await groupService.get(group.id)).myMembershipStatus).toBe('active');
  }, 10_000);

  it('un admin de communauté peut confier le groupe qu’il crée à un autre admin', async () => {
    await demoLogin(MOUSSA); // admin de Ouakam
    expect((await adminService.listAdminChoices()).map((a) => a.id)).toContain(FATOU);
    const group = await groupService.create({
      communityId: 'c-ouakam',
      name: 'Tontine Confiée',
      contributionAmount: 2500,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 4,
      paymentDueDay: 5,
      startDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      attributionMode: 'random',
      adminId: FATOU,
    });
    expect(group.adminId).toBe(FATOU);
    // Moussa n'en est ni l'admin ni membre : il n'y a plus accès.
    await expect(groupService.get(group.id)).rejects.toThrow(/ne faites pas partie/);
    await demoLogin(FATOU);
    expect((await groupService.get(group.id)).canManage).toBe(true);
  }, 10_000);

  it('transfère un groupe vers une autre communauté et retire l’accès de l’ancienne', async () => {
    await adminService.transferGroup('g-famille', 'c-afp', FATOU);
    await demoLogin(FATOU);
    expect((await groupService.get('g-famille')).communityName).toBe('AFP');
    await demoLogin(MOUSSA);
    await expect(
      groupService.update('g-famille', { name: 'Modification interdite' }),
    ).rejects.toThrow();
  }, 10_000);

  it('ne découvre les groupes ouverts que dans ses communautés et garde les groupes privés cachés', async () => {
    const open = await groupService.create({
      communityId: 'c-ouakam',
      joinPolicy: 'community',
      name: 'Tontine Ouverte',
      contributionAmount: 2500,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 4,
      paymentDueDay: 5,
      startDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      attributionMode: 'random',
      adminId: MOUSSA,
    });
    const privateGroup = await groupService.create({
      communityId: 'c-ouakam',
      name: 'Tontine Privée',
      contributionAmount: 2500,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 4,
      paymentDueDay: 5,
      startDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      attributionMode: 'random',
      adminId: MOUSSA,
    });

    await demoLogin('u-p1');
    expect((await groupService.listDiscoverable()).map(({ group }) => group.id)).toContain(open.id);
    expect((await groupService.listDiscoverable()).map(({ group }) => group.id)).not.toContain(
      privateGroup.id,
    );
    await groupService.requestJoinOpen(open.id);
    expect(
      (await groupService.listMine()).find(({ group }) => group.id === open.id)?.communityName,
    ).toBe('Ouakam');

    await demoLogin('u-p10');
    expect((await groupService.listDiscoverable()).map(({ group }) => group.id)).not.toContain(
      open.id,
    );
    await expect(groupService.requestJoinOpen(open.id)).rejects.toThrow(/communauté/);
  }, 20_000);

  it('un groupe suspendu n’accepte plus de paiement', async () => {
    await adminService.suspendGroup('g-famille');
    await demoLogin('u-p1');
    const { currentRound } = await groupService.get('g-famille');
    await expect(
      paymentService.initiatePayment({ roundId: currentRound?.id ?? '', method: 'wave' }),
    ).rejects.toThrow(/suspendu/);
  }, 10_000);

  it('un admin ne peut relancer qu’un membre actif de son groupe', async () => {
    await demoLogin(MOUSSA);
    const { currentRound } = await groupService.get('g-famille');
    expect(currentRound).toBeDefined();
    await expect(
      paymentService.remindMember(currentRound?.id ?? '', 'u-not-a-member'),
    ).rejects.toThrow(/ne fait pas partie de ce groupe/);
  }, 10_000);

  it('relance : une seule par membre et par jour, tracée au journal', async () => {
    await demoLogin(MOUSSA);
    const { currentRound } = await groupService.get('g-famille');
    const roundId = currentRound?.id ?? '';
    const count = await paymentService.remindLate(roundId);
    expect(count).toBeGreaterThan(0);
    await expect(paymentService.remindLate(roundId)).rejects.toThrow(/déjà été relancés/);
    await demoLogin('u-super');
    const audit = await reportService.auditLog();
    expect(audit.filter(({ entry }) => entry.action === 'reminder_sent')).toHaveLength(1);
  }, 10_000);

  it('échange de tour : accord du membre, validation de l’admin, parts échangées', async () => {
    await demoLogin(MOUSSA);
    const upcoming = (await roundService.list('g-famille')).filter(
      (view) =>
        view.round.status === 'upcoming' &&
        view.round.recipientType !== 'platform' &&
        view.beneficiaries[0]?.id !== MOUSSA,
    );
    const [a, b] = upcoming.filter(
      (view, index) =>
        upcoming.findIndex((other) => other.beneficiaries[0]?.id === view.beneficiaries[0]?.id) ===
        index,
    );
    const requester = a?.beneficiaries[0]?.id ?? '';
    const partner = b?.beneficiaries[0]?.id ?? '';
    await demoLogin(requester);
    await swapService.request(a?.round.id ?? '', b?.round.id ?? '', partner);
    await demoLogin(partner);
    const [swap] = await swapService.list('g-famille');
    await swapService.respond(swap?.request.id ?? '', true);
    await demoLogin(MOUSSA);
    await swapService.decide(swap?.request.id ?? '', true);
    const after = await roundService.list('g-famille');
    const holder = (roundId?: string) =>
      after.find((view) => view.round.id === roundId)?.beneficiaries.map((person) => person.id);
    expect(holder(a?.round.id)).toContain(partner);
    expect(holder(b?.round.id)).toContain(requester);
  }, 10_000);

  it('paiement par versements : le tour est payé quand le total est atteint', async () => {
    await demoLogin(MOUSSA);
    const group = await groupService.create({
      communityId: 'c-ouakam',
      name: 'Tontine Journalière',
      contributionAmount: 500,
      frequency: 'daily',
      turnLength: 7,
      maxMembers: 2,
      paymentDueDay: 1,
      startDate: new Date(Date.now() + 86_400_000).toISOString(),
      attributionMode: 'manual',
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
    const roundId = (await groupService.get(group.id)).currentRound?.id ?? '';
    const other = members.find((member) => member.user.id !== MOUSSA)?.user.id ?? '';

    // 500 par jour sur 7 jours : 3 500. Un jour, puis trois jours en espèces.
    await paymentService.recordCash(roundId, other, 1);
    await paymentService.recordCash(roundId, other, 3);
    const row = (await paymentService.listForRound(roundId)).find((r) => r.user.id === other);
    expect(row?.status).not.toBe('paid');
    // L'admin voit ce qui est déjà versé sur le total du tour.
    expect(row).toMatchObject({ paidAmount: 2000, totalAmount: 3500 });
    await demoLogin(other);
    expect((await groupService.get(group.id)).myAmountDue).toBe(1500);

    // Le reste : le tour est payé.
    await demoLogin(MOUSSA);
    await paymentService.recordCash(roundId, other);
    const paid = (await paymentService.listForRound(roundId)).find((r) => r.user.id === other);
    expect(paid?.status).toBe('paid');
    await expect(paymentService.recordCash(roundId, other, 1)).rejects.toThrow(/déjà payé/);
  }, 15_000);

  it('impayé à l’heure limite : pénalité, versement quand même, dette remboursée', async () => {
    await demoLogin(MOUSSA);
    const group = await groupService.create({
      communityId: 'c-ouakam',
      name: 'Tontine Retards',
      contributionAmount: 1000,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 2,
      paymentDueDay: 5,
      paymentDueTime: '12:00',
      latePenalty: 500,
      startDate: new Date(Date.now() + 86_400_000).toISOString(),
      attributionMode: 'manual',
    });
    await membershipService.addByPhone(group.id, '772345678');
    const members = (await membershipService.list(group.id)).filter(
      (member) => member.membership.status === 'active',
    );
    // Moussa d'abord : il reçoit le tour 1 ; l'autre membre ne paie pas.
    const ordered = [...members].sort((a) => (a.user.id === MOUSSA ? -1 : 1));
    await roundService.setManualOrder(
      group.id,
      ordered.map((member) => member.membership.id),
    );
    await groupService.start(group.id);
    const roundId = (await groupService.get(group.id)).currentRound?.id ?? '';
    const other = ordered[1]?.user.id ?? '';
    await paymentService.recordCash(roundId, MOUSSA);
    await expect(roundService.payout(roundId)).rejects.toThrow(/heure limite/);

    // L'heure limite passe : pénalité d'office, puis versement malgré l'impayé.
    await simulateDeadlinePassed(roundId);
    const late = (await paymentService.listForRound(roundId)).find((r) => r.user.id === other);
    expect(late).toMatchObject({ status: 'late', penalty: 500 });
    await roundService.payout(roundId);
    const [debt] = await paymentService.listDebts(group.id);
    expect(debt?.debt).toMatchObject({ userId: other, amount: 1000, penaltyAmount: 500 });

    // Le membre voit sa dette ; l'admin enregistre le remboursement en espèces.
    await demoLogin(other);
    expect(await paymentService.listDebts(group.id)).toHaveLength(1);
    await demoLogin(MOUSSA);
    await paymentService.recordDebtPayment(debt?.debt.id ?? '');
    expect((await paymentService.listDebts(group.id))[0]?.debt.status).toBe('settled');

    // Versement réel : l'admin note l'envoi Wave, le bénéficiaire confirme la réception.
    await roundService.markPayoutSent(roundId, MOUSSA, 'wave', 'TX-0001');
    await expect(roundService.markPayoutSent(roundId, MOUSSA, 'wave', 'TX-0002')).rejects.toThrow(
      /déjà enregistré/,
    );
    await roundService.confirmPayoutReceived(roundId);
    const paidOut = (await roundService.list(group.id)).find((view) => view.round.id === roundId);
    expect(paidOut?.round.transfers?.[MOUSSA]).toMatchObject({ ref: 'TX-0001' });
    expect(paidOut?.round.transfers?.[MOUSSA]?.receivedAt).toBeDefined();
  }, 15_000);

  it('cagnotte de 300 000 FCFA ou plus : demande de l’admin, validation du super admin', async () => {
    await demoLogin(MOUSSA);
    const group = await groupService.create({
      communityId: 'c-ouakam',
      name: 'Grosse Tontine',
      contributionAmount: 200_000,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 2,
      paymentDueDay: 5,
      startDate: new Date(Date.now() + 86_400_000).toISOString(),
      attributionMode: 'manual',
    });
    await membershipService.addByPhone(group.id, '772345678');
    const members = (await membershipService.list(group.id)).filter(
      (member) => member.membership.status === 'active',
    );
    const ordered = [...members].sort((a) => (a.user.id === MOUSSA ? -1 : 1));
    await roundService.setManualOrder(
      group.id,
      ordered.map((member) => member.membership.id),
    );
    await groupService.start(group.id);
    const roundId = (await groupService.get(group.id)).currentRound?.id ?? '';
    for (const member of ordered) await paymentService.recordCash(roundId, member.user.id);

    expect(await roundService.payout(roundId)).toBe('pending_approval');
    expect((await roundService.list(group.id))[0]?.round.payoutRequestedAt).toBeDefined();
    await demoLogin('u-super');
    const row = (await financeService.payouts()).find((item) => item.round.id === roundId);
    expect(row?.stage).toBe('approval');
    expect(await roundService.payout(roundId)).toBe('paid');
  }, 15_000);

  it('une dette se rembourse en ligne (Wave)', async () => {
    await demoLogin(MOUSSA);
    const group = await groupService.create({
      communityId: 'c-ouakam',
      name: 'Tontine Dette En Ligne',
      contributionAmount: 1000,
      frequency: 'monthly',
      turnLength: 1,
      maxMembers: 2,
      paymentDueDay: 5,
      startDate: new Date(Date.now() + 86_400_000).toISOString(),
      attributionMode: 'manual',
    });
    await membershipService.addByPhone(group.id, '772345678');
    const members = (await membershipService.list(group.id)).filter(
      (member) => member.membership.status === 'active',
    );
    const ordered = [...members].sort((a) => (a.user.id === MOUSSA ? -1 : 1));
    await roundService.setManualOrder(
      group.id,
      ordered.map((member) => member.membership.id),
    );
    await groupService.start(group.id);
    const roundId = (await groupService.get(group.id)).currentRound?.id ?? '';
    const other = ordered[1]?.user.id ?? '';
    await paymentService.recordCash(roundId, MOUSSA);
    await simulateDeadlinePassed(roundId);
    await roundService.payout(roundId);

    await demoLogin(other);
    const [debt] = await paymentService.listDebts(group.id);
    const { paymentId } = await paymentService.payDebt(debt?.debt.id ?? '', 'wave');
    await completeSimulatedCheckout(paymentId, true);
    applyPendingConfirmations(Date.now() + 60_000);
    expect((await paymentService.listDebts(group.id))[0]?.debt).toMatchObject({
      status: 'settled',
      settledVia: 'online',
    });
  }, 15_000);

  it('un membre peut avoir deux parts et reçoit deux tours avec une cotisation doublée', async () => {
    await demoLogin('u-admin2');
    await membershipService.addByPhone('g-bureau', '781234567');

    let overview = await groupService.get('g-bureau');
    expect(overview.activeMemberCount).toBe(5);
    expect(overview.activeShareCount).toBe(6);

    const members = (await membershipService.list('g-bureau'))
      .filter((member) => member.membership.status === 'active')
      .map((member) => member.membership.id);
    await roundService.setManualOrder('g-bureau', members);
    await groupService.start('g-bureau');

    overview = await groupService.get('g-bureau');
    expect(overview.totalRounds).toBe(6);
    expect(overview.myAmountDue).toBe(20_000);
    const rounds = await roundService.list('g-bureau');
    expect(rounds.filter(({ beneficiary }) => beneficiary.id === 'u-admin2')).toHaveLength(2);
    expect(rounds[0]?.round.potAmount).toBe(60_000);
  }, 15_000);

  it('le super administrateur peut aussi attribuer une part supplémentaire', async () => {
    await membershipService.addByPhone('g-bureau', '781234567');
    const overview = await groupService.get('g-bureau');
    expect(overview.activeShareCount).toBe(6);
    expect(overview.activeMemberCount).toBe(5);
  }, 10_000);

  it('attribue en une seule opération le nombre de parts demandé', async () => {
    await demoLogin('u-admin2');
    await groupService.update('g-bureau', { maxMembers: 7 });
    const assigned = await membershipService.addByPhone('g-bureau', '781234567', 2);
    const overview = await groupService.get('g-bureau');
    const members = await membershipService.list('g-bureau');

    expect(assigned).toBe(2);
    expect(overview.activeShareCount).toBe(7);
    expect(members.filter((member) => member.user.id === 'u-admin2')).toHaveLength(3);
  }, 10_000);

  it('configure les périodes, partage la cagnotte par part et crédite les revenus du Superadmin', async () => {
    const group = await groupService.create({
      name: 'Tontine 10 jours',
      contributionAmount: 1000,
      frequency: 'daily',
      maxMembers: 6,
      paymentDueDay: 5,
      startDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      attributionMode: 'manual',
      adminId: 'u-admin2',
      turnLength: 10,
      sharesPerRound: 3,
      membershipFeeAmount: 3000,
      collectMembershipFee: true,
      reserveFinalTurn: true,
    });
    await membershipService.addByPhone(group.id, '772345678', 2);
    for (const phone of ['763456789', '704567890', '775678901', '786789012']) {
      await membershipService.addByPhone(group.id, phone);
    }
    const members = await membershipService.list(group.id);
    const orderedIds = members
      .filter((member) => member.membership.status === 'active')
      .sort((a, b) => a.membership.joinedAt.localeCompare(b.membership.joinedAt))
      .map((member) => member.membership.id);
    await roundService.setManualOrder(group.id, orderedIds);
    await groupService.start(group.id);

    const rounds = await roundService.list(group.id);
    await demoLogin('u-p1');
    const memberOverview = await groupService.get(group.id);
    expect(duesOf([memberOverview])[0]?.amount).toBe(23_000);
    await demoLogin('u-super');
    expect(rounds).toHaveLength(3);
    expect(rounds[0]?.round.potAmount).toBe(60_000);
    expect(rounds[0]?.beneficiaryShares[0]).toMatchObject({
      shareCount: 2,
      amount: 40_000,
    });
    expect(rounds[2]?.round.recipientType).toBe('platform');

    for (const roundView of rounds) {
      const current = (await roundService.list(group.id)).find(
        ({ round }) => round.id === roundView.round.id,
      );
      if (!current || current.round.status === 'upcoming') continue;
      const uniqueUsers = [...new Set(members.map((member) => member.user.id))];
      for (const userId of uniqueUsers) {
        await paymentService.recordCash(current.round.id, userId);
      }
      await roundService.payout(current.round.id);
    }

    await demoLogin('u-p1');
    const history = await paymentService.listMine(group.id);
    expect(history.received[0]?.beneficiaryAmounts?.['u-p1']).toBe(40_000);
    await demoLogin('u-super');
    const payouts = await financeService.payouts();
    expect(payouts.find(({ round }) => round.id === rounds[0]?.round.id)?.collected).toBe(75_000);
    expect(payouts.find(({ round }) => round.id === rounds[2]?.round.id)?.collected).toBe(60_000);
    const earnings = await financeService.earnings();
    expect(earnings.earnedTotal).toBe(75_000);
    await financeService.compensateAdmin(group.id, 15_000, 'Rémunération de gestion');
    expect((await financeService.earnings()).available).toBe(60_000);
  }, 60_000);

  it('seul un groupe terminé peut être archivé', async () => {
    await expect(adminService.archiveGroup('g-famille')).rejects.toThrow(/terminé/);
    await adminService.archiveGroup('g-amies');
    const amies = (await groupService.listManaged()).find((g) => g.group.id === 'g-amies');
    expect(amies?.group.archivedAt).toBeDefined();
  }, 10_000);

  it('cherche un membre par nom sans accent, ou par numéro', async () => {
    expect((await memberService.list('aissatou')).map((m) => m.user.firstName)).toEqual([
      'Aïssatou',
    ]);
    expect((await memberService.list('772 345')).map((m) => m.user.firstName)).toEqual(['Awa']);
  }, 10_000);

  it('change le numéro d’un membre seulement avec le code reçu sur le nouveau numéro', async () => {
    await authService.sendOtp('779998877'); // code envoyé au NOUVEAU numéro
    const code = lastOtpFor('779998877') ?? '';
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(memberService.changePhone('u-p1', '779998877', wrong)).rejects.toThrow(
      /Code incorrect/,
    );
    await memberService.changePhone('u-p1', '779998877', code);
    expect((await memberService.get('u-p1')).summary.user.phone).toBe('779998877');
  }, 10_000);

  it('bloquer un membre l’empêche de se connecter ; réinitialiser son PIN impose le SMS', async () => {
    await memberService.resetPin('u-p1');
    // PIN réinitialisé : il ne permet plus d'entrer, le passage par SMS est obligatoire.
    await expect(authService.loginWithPin('772345678', '1234')).rejects.toThrow(/Créez d’abord/);
    await memberService.block('u-p1');
    await expect(authService.sendOtp('772345678')).rejects.toThrow(/bloqué/);
  }, 10_000);

  it('le super admin crée un groupe confié à un admin, sans y cotiser lui-même', async () => {
    const input = {
      name: 'Tontine Rufisque',
      contributionAmount: 5000,
      frequency: 'daily' as const,
      maxMembers: 8,
      turnLength: 10,
      sharesPerRound: 1,
      membershipFeeAmount: 0,
      collectMembershipFee: false,
      reserveFinalTurn: true,
      paymentDueDay: 5,
      startDate: new Date().toISOString(),
      attributionMode: 'random' as const,
    };
    await expect(groupService.create(input)).rejects.toThrow(/administrateur responsable/);
    const group = await groupService.create({ ...input, adminId: FATOU });
    expect(group.adminId).toBe(FATOU);
    const overview = await groupService.get(group.id);
    expect(overview.activeMemberCount).toBe(0); // le super admin n'en est pas membre
    expect(overview.adminName).toBe('Fatou Ndiaye');
  }, 10_000);

  it('le super admin crée un membre, qui devra créer son PIN à la 1re connexion', async () => {
    const id = await memberService.create({
      firstName: 'Seydou',
      lastName: 'Kane',
      phone: '775551234',
    });
    const profile = await memberService.get(id);
    expect(profile.summary.user.globalRole).toBe('user');
    expect(profile.summary.pinPending).toBe(true);
    await expect(
      memberService.create({ firstName: 'Autre', lastName: 'Personne', phone: '775551234' }),
    ).rejects.toThrow(/existe déjà/);
  }, 10_000);
});
