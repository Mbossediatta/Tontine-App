// Pages du super admin avec les vrais services contre Supabase local : paramètres (clé
// PayTech dans le coffre-fort), journaux, rapport, versements, revenus, réconciliation,
// litiges, SMS et notifications. Aucune annonce n'est envoyée (elle déclencherait des SMS).
// Comptes et données du test effacés à la fin (journaux et paramètres compris).
import {
  adminService,
  communicationService,
  disputeService,
  financeService,
  groupService,
  membershipService,
  notificationService,
  paymentService,
  reportService,
  roundService,
  settingsService,
} from '@/services';
import { signInAs, sql } from './local';

const SUPER = '00000000-0000-4000-8000-00000000a001';
const ADMIN = '00000000-0000-4000-8000-00000000a002';
const AWA = '00000000-0000-4000-8000-00000000a011';
const COMMUNITY = '00000000-0000-4000-8000-00000000ac01';
const USERS = [SUPER, ADMIN, AWA];
const AWA_PHONE = '700095511';
let savedPayment = '';

function cleanup() {
  const ids = `(${USERS.map((id) => `'${id}'`).join(', ')})`;
  const groups = `(select id from public.groups where created_by in ${ids})`;
  sql(`
    alter table public.audit_log disable trigger audit_log_append_only;
    alter table public.security_events disable trigger security_events_append_only;
    delete from public.audit_log where actor_id in ${ids} or group_id in ${groups};
    delete from public.security_events where user_id in ${ids};
    alter table public.audit_log enable trigger audit_log_append_only;
    alter table public.security_events enable trigger security_events_append_only;
    delete from public.disputes where user_id in ${ids};
    delete from public.admin_compensations where group_id in ${groups};
    delete from public.platform_earnings where group_id in ${groups};
    delete from public.provider_ledger where payment_id in (select id from public.payments where user_id in ${ids});
    delete from public.payments where user_id in ${ids};
    delete from public.groups where created_by in ${ids};
    delete from public.communities where id = '${COMMUNITY}';
    delete from public.profiles where id in ${ids};
    delete from auth.users where id in ${ids};
  `);
}

beforeAll(() => {
  // Une vraie clé PayTech est enregistrée : le test ne l'écrase jamais.
  if (sql(`select count(*) from vault.secrets where name = 'paytech_api_secret'`) !== '0') {
    throw new Error('Une clé PayTech est déjà enregistrée : test des paramètres non lancé.');
  }
  cleanup();
  // Paramètres de paiement du poste de développement : restaurés à la fin.
  savedPayment = sql(`select payment::text from public.platform_settings`);
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
      id || '@users.calebasse.invalid', '', now(), '{"provider": "email", "providers": ["email"]}',
      '{}', now(), now(), '', '', '', ''
    from unnest(array[${USERS.map((id) => `'${id}'`).join(', ')}]) as id;
    insert into public.profiles (id, first_name, last_name, phone, global_role, payout_phone) values
      ('${SUPER}', 'Test', 'Super', '700095501', 'super_admin', null),
      ('${ADMIN}', 'Test', 'Admin', '700095502', 'admin', '700095502'),
      ('${AWA}', 'Test', 'Awa', '${AWA_PHONE}', 'user', '${AWA_PHONE}');
    insert into public.communities (id, name) values ('${COMMUNITY}', 'Communauté test super admin');
    insert into public.community_admins (community_id, admin_id) values ('${COMMUNITY}', '${ADMIN}');
  `);
});

afterAll(() => {
  sql(`
    update public.platform_settings set payment = '${savedPayment.replace(/'/g, "''")}'::jsonb;
    delete from vault.secrets where name = 'paytech_api_secret'
      and description = 'Clé secrète PayTech (API_SECRET)'
      and (select payment ->> 'secretKeyHint' from public.platform_settings) is null;
  `);
  cleanup();
});

describe('pages du super admin sur Supabase', () => {
  let groupId = '';
  let roundId = '';

  it('prépare un groupe démarré, payé, avec frais d’adhésion', async () => {
    await signInAs(ADMIN);
    const today = new Date().toISOString().slice(0, 10);
    const group = await groupService.create({
      name: 'Tontine test super admin',
      contributionAmount: 1000,
      frequency: 'daily',
      turnLength: 2,
      maxMembers: 2,
      paymentDueDay: 1,
      startDate: new Date(`${today}T00:00:00Z`).toISOString(),
      attributionMode: 'random',
      collectMembershipFee: true,
      membershipFeeAmount: 500,
      reserveFinalTurn: false,
    });
    groupId = group.id;
    await membershipService.addByPhone(groupId, AWA_PHONE);
    await roundService.drawOrder(groupId);
    await groupService.start(groupId);
    roundId = (await roundService.list(groupId))[0]?.round.id ?? '';
    await paymentService.recordCash(roundId, ADMIN);
    await paymentService.recordCash(roundId, AWA);
  });

  it('paramètres : la clé secrète PayTech n’est jamais relue, seulement son indice', async () => {
    await signInAs(SUPER);
    const settings = await settingsService.get();
    expect(settings.templates.reminder).toContain('{prenom}');
    await settingsService.update(
      'payment',
      { ...settings.payment, publicKey: 'pk_it' },
      'sk_it_test_7c2d',
    );
    const updated = await settingsService.get();
    expect(updated.payment).toMatchObject({ publicKey: 'pk_it', secretKeyHint: '•••• 7c2d' });
    expect(JSON.stringify(updated)).not.toContain('sk_it_test_7c2d');
    await expect(
      settingsService.update('rules', { ...settings.rules, graceDays: 99 }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('journaux, rapport, versements et revenus', async () => {
    const audit = await reportService.auditLog();
    expect(audit.some((row) => row.entry.summary.includes('Tontine test super admin'))).toBe(true);
    expect(audit.find((row) => row.entry.actorId === ADMIN)?.actorName).toBe('Test Admin');
    expect(Array.isArray(await reportService.securityLog())).toBe(true);

    const today = new Date().toISOString();
    const report = await reportService.report(today, today);
    expect(report.byGroup.find((row) => row.id === groupId)).toMatchObject({
      collected: 5000, // 2 × (2 000 de cotisation + 500 de frais d'adhésion)
      expected: 5000,
      rate: 100,
    });

    const payouts = await financeService.payouts();
    const mine = payouts.find((row) => row.round.id === roundId);
    expect(mine).toMatchObject({ stage: 'ready', collected: 5000, adminName: 'Test Admin' });
    await financeService.blockPayout(roundId, 'Vérification');
    expect((await financeService.payouts()).find((row) => row.round.id === roundId)?.stage).toBe(
      'blocked',
    );
    await financeService.unblockPayout(roundId);

    const earnings = await financeService.earnings();
    expect(
      earnings.earnings.filter((row) => row.groupId === groupId).map((row) => row.amount),
    ).toEqual([500, 500]);
    await financeService.compensateAdmin(groupId, 300, 'Suivi du groupe');
    expect((await financeService.earnings()).compensations[0]).toMatchObject({
      amount: 300,
      adminName: 'Test Admin',
    });

    const reconciliation = await financeService.reconciliation(today);
    expect(reconciliation.recordedCash).toBeGreaterThanOrEqual(5000);
  });

  it('litiges, SMS et refus pour un admin', async () => {
    expect(Array.isArray(await disputeService.list())).toBe(true);
    const sms = await communicationService.smsStats(30);
    expect(sms.byKind.map((row) => row.kind)).toEqual([
      'otp',
      'reminder',
      'announcement',
      'payment',
      'payout',
    ]);
    await signInAs(ADMIN);
    await expect(financeService.payouts()).rejects.toMatchObject({ code: 'forbidden' });
    await expect(settingsService.get()).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      communicationService.announce({ kind: 'all' }, 'Titre', 'Message'),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await adminService.dashboard()).todo.map((item) => item.kind)).toContain(
      'ready_for_payout',
    );
  });

  it('notifications réelles : liste, lecture, préférences', async () => {
    await signInAs(AWA);
    const list = await notificationService.list();
    expect(list.some((item) => item.title === 'Paiement en espèces enregistré')).toBe(true);
    const unread = list.find((item) => !item.read);
    if (unread) await notificationService.markRead(unread.id);
    await notificationService.markAllRead();
    expect((await notificationService.list()).every((item) => item.read)).toBe(true);
    await notificationService.updatePreferences({
      reminders: false,
      beneficiary: true,
      payments: true,
    });
    expect(await notificationService.getPreferences()).toEqual({
      reminders: false,
      beneficiary: true,
      payments: true,
    });
  });
});
