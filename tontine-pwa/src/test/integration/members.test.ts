// Membres et administrateurs (super admin) : les vrais services de l'application contre
// Supabase local, Edge Functions comprises. Aucun SMS n'est envoyé (code enregistré
// directement). Comptes et données du test effacés à la fin (journaux compris).
import { adminService, groupService, memberService, membershipService } from '@/services';
import { issueOtp, signInAs, sql } from './local';

const SUPER = '00000000-0000-4000-8000-00000000f001';
const ADMIN_A = '00000000-0000-4000-8000-00000000f002';
const ADMIN_B = '00000000-0000-4000-8000-00000000f003';
const MEMBER = '00000000-0000-4000-8000-00000000f011';
const COMMUNITY = '00000000-0000-4000-8000-00000000fc01';
const USERS = [SUPER, ADMIN_A, ADMIN_B, MEMBER];
const MEMBER_PHONE = '700098811';
const NEW_PHONE = '700098812';
const CREATED_PHONE = '700098850';
const PHONES = [
  '700098801',
  '700098802',
  '700098803',
  MEMBER_PHONE,
  NEW_PHONE,
  CREATED_PHONE,
  '700098860',
];

function cleanup() {
  const created = `(select id from public.profiles where phone in (${PHONES.map((p) => `'${p}'`).join(', ')}))`;
  const ids = `(${USERS.map((id) => `'${id}'`).join(', ')})`;
  sql(`
    alter table public.audit_log disable trigger audit_log_append_only;
    alter table public.security_events disable trigger security_events_append_only;
    delete from public.audit_log where actor_id in ${ids} or actor_id in ${created}
      or group_id in (select id from public.groups where created_by in ${ids});
    delete from public.security_events where user_id in ${ids} or user_id in ${created};
    alter table public.audit_log enable trigger audit_log_append_only;
    alter table public.security_events enable trigger security_events_append_only;
    delete from private.auth_otps where phone in (${PHONES.map((p) => `'${p}'`).join(', ')});
    delete from public.groups where created_by in ${ids};
    delete from public.communities where id = '${COMMUNITY}';
    create temp table doomed as select id from public.profiles where id in ${ids} or id in ${created};
    delete from public.profiles where id in (select id from doomed);
    delete from auth.users where id in (select id from doomed) or id in ${ids};
  `);
}

beforeAll(() => {
  cleanup();
  // Comptes Auth complets (comme seed.sql) : les Edge Functions vérifient la session.
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
      id || '@users.calebasse.invalid', '', now(), '{"provider": "email", "providers": ["email"]}',
      '{}', now(), now(), '', '', '', ''
    from unnest(array[${USERS.map((id) => `'${id}'`).join(', ')}]) as id;
    insert into public.profiles (id, first_name, last_name, phone, global_role, payout_phone) values
      ('${SUPER}', 'Test', 'Super', '700098801', 'super_admin', null),
      ('${ADMIN_A}', 'Admin', 'Alpha', '700098802', 'admin', null),
      ('${ADMIN_B}', 'Admin', 'Beta', '700098803', 'admin', null),
      ('${MEMBER}', 'Membre', 'Test', '${MEMBER_PHONE}', 'user', '${MEMBER_PHONE}');
    insert into public.communities (id, name) values ('${COMMUNITY}', 'Communauté test membres');
    insert into public.community_admins (community_id, admin_id) values ('${COMMUNITY}', '${ADMIN_A}');
  `);
});

afterAll(() => cleanup());

describe('membres et administrateurs sur Supabase', () => {
  let groupId = '';

  it('un admin ne voit pas la liste des membres de la plateforme', async () => {
    await signInAs(ADMIN_A);
    const group = await groupService.create({
      name: 'Tontine test membres',
      contributionAmount: 2000,
      frequency: 'weekly',
      turnLength: 2,
      maxMembers: 4,
      paymentDueDay: 1,
      startDate: new Date('2030-03-04').toISOString(),
      attributionMode: 'random',
    });
    groupId = group.id;
    await membershipService.addByPhone(groupId, MEMBER_PHONE);
    await expect(memberService.list()).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('le super admin liste et cherche les membres', async () => {
    await signInAs(SUPER);
    const all = await memberService.list();
    const ids = all.map((item) => item.user.id);
    expect(ids).toEqual(expect.arrayContaining([ADMIN_A, ADMIN_B, MEMBER]));
    expect(ids).not.toContain(SUPER);
    const found = await memberService.list('98811');
    expect(found.map((item) => item.user.id)).toEqual([MEMBER]);
    expect(found[0]).toMatchObject({ groupCount: 1, lateCount: 0, pinPending: true });

    const profile = await memberService.get(MEMBER);
    expect(profile.groups).toEqual([
      expect.objectContaining({ role: 'member', status: 'active', shareCount: 1 }),
    ]);
    expect(profile.payments).toEqual([]);
  });

  it('crée un compte participant (refus si le numéro est pris)', async () => {
    const id = await memberService.create({
      firstName: 'Nouveau',
      lastName: 'Compte',
      phone: CREATED_PHONE,
    });
    expect(sql(`select global_role from public.profiles where id = '${id}'`)).toBe('user');
    await expect(
      memberService.create({ firstName: 'Encore', lastName: 'Lui', phone: CREATED_PHONE }),
    ).rejects.toThrow(/existe déjà/);
    await expect(
      memberService.create({ firstName: 'x<script>', lastName: 'Pirate', phone: '700098860' }),
    ).rejects.toThrow(/caractères non autorisés|lettres/);
    // Le compte Auth du refus a été retiré : aucun profil n'existe pour ce numéro.
    expect(sql(`select count(*) from public.profiles where phone = '700098860'`)).toBe('0');
  });

  it('bloque, débloque et réinitialise le PIN', async () => {
    await memberService.block(MEMBER);
    expect(sql(`select is_suspended from public.profiles where id = '${MEMBER}'`)).toBe('t');
    await memberService.unblock(MEMBER);
    expect(sql(`select is_suspended from public.profiles where id = '${MEMBER}'`)).toBe('f');
    await memberService.resetPin(MEMBER);
    expect(sql(`select must_reset from private.auth_pins where user_id = '${MEMBER}'`)).toBe('t');
    expect(
      sql(
        `select count(*) from public.notifications where user_id = '${MEMBER}' and type = 'security'`,
      ),
    ).toBe('1');
  });

  it('change le numéro seulement avec le code reçu sur le nouveau numéro', async () => {
    issueOtp(NEW_PHONE, '482913');
    await expect(memberService.changePhone(MEMBER, NEW_PHONE, '000000')).rejects.toThrow(
      /Code incorrect/,
    );
    await memberService.changePhone(MEMBER, NEW_PHONE, '482913');
    expect(
      sql(`select phone || '/' || payout_phone from public.profiles where id = '${MEMBER}'`),
    ).toBe(`${NEW_PHONE}/${NEW_PHONE}`);
  });

  it('gère un admin : modification, suspension, réattribution puis retrait du rôle', async () => {
    await adminService.updateAdmin(ADMIN_A, {
      firstName: 'Admin',
      lastName: 'Alpha-Bis',
      phone: '700098802',
    });
    expect(sql(`select last_name from public.profiles where id = '${ADMIN_A}'`)).toBe('Alpha-Bis');
    await expect(
      adminService.updateAdmin(ADMIN_A, {
        firstName: 'Admin',
        lastName: 'Alpha',
        phone: NEW_PHONE,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    await adminService.suspend(ADMIN_B);
    await expect(adminService.reassignGroups(ADMIN_A, ADMIN_B)).rejects.toThrow(/suspendu/);
    await adminService.reactivate(ADMIN_B);

    await expect(adminService.deleteAdmin(ADMIN_A)).rejects.toThrow(
      /Réattribuez d’abord ses 1 groupe/,
    );
    expect(await adminService.reassignGroups(ADMIN_A, ADMIN_B)).toBe(1);
    expect((await groupService.get(groupId)).group.adminId).toBe(ADMIN_B);
    await adminService.deleteAdmin(ADMIN_A);
    expect(sql(`select global_role from public.profiles where id = '${ADMIN_A}'`)).toBe('user');
    expect(sql(`select count(*) from public.community_admins where admin_id = '${ADMIN_A}'`)).toBe(
      '0',
    );
  });
});
