-- Droits paramétrables (cahier AFP § 14 : « les droits devront être paramétrables »).
-- Chaque action sensible a une liste de rôles autorisés, réglable par l'administration
-- générale dans Paramètres ; par défaut, exactement les rôles d'avant cette migration.
-- Garde-fou (cahier § 17, séparation des fonctions) : un même rôle ne peut jamais à la fois
-- contrôler et décider, ni décider et payer, une même dépense ou un même financement.
-- Les fonctions plus bas sont celles en vigueur, à l'identique : seule leur liste fixe de
-- rôles est remplacée par private.org_roles_for(organisation, action).

-- Catalogue des actions : clé, libellé, explication, rôles par défaut.
create or replace function private.org_permission_catalog()
returns table (key text, label text, description text, default_roles public.org_role[], rank integer)
language sql
immutable
set search_path = ''
as $$
  values
    ('common_fund', 'Gérer le fonds commun', 'Règles de répartition, versements reçus, annulation d’écritures.',
      array['org_admin', 'finance_admin']::public.org_role[], 1),
    ('expense_verify', 'Contrôler les dépenses', 'Vérifier une demande de dépense avant la décision.',
      array['finance_admin', 'controller']::public.org_role[], 2),
    ('expense_decide', 'Décider des dépenses', 'Approuver ou refuser une dépense.',
      array['validator', 'org_admin']::public.org_role[], 3),
    ('expense_pay', 'Payer les dépenses', 'Engager et payer une dépense approuvée sur la caisse centrale.',
      array['finance_admin']::public.org_role[], 4),
    ('financing_review', 'Instruire les financements', 'Vérifier le dossier et l’évaluer.',
      array['org_admin', 'projects_manager', 'finance_admin']::public.org_role[], 5),
    ('financing_decide', 'Décider des financements', 'Accorder ou refuser un financement.',
      array['validator', 'org_admin']::public.org_role[], 6),
    ('financing_disburse', 'Décaisser les financements', 'Verser l’argent d’un financement accordé.',
      array['finance_admin']::public.org_role[], 7),
    ('financing_repay', 'Enregistrer les remboursements', 'Remboursements des prêts.',
      array['finance_admin', 'org_admin']::public.org_role[], 8),
    ('financing_close', 'Clôturer les financements', 'Clore un dossier après son suivi.',
      array['org_admin', 'projects_manager']::public.org_role[], 9),
    ('projects', 'Gérer les projets', 'Créer et suivre les projets de toute l’organisation.',
      array['org_admin', 'projects_manager']::public.org_role[], 10)
$$;

-- Rôles autorisés pour une action dans une organisation (réglage, sinon défaut).
create or replace function private.org_roles_for(p_org uuid, p_action text)
returns public.org_role[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array_agg(r::public.org_role)
     from public.organizations o,
       jsonb_array_elements_text(o.settings -> 'permissions' -> p_action) r
     where o.id = p_org and jsonb_typeof(o.settings -> 'permissions' -> p_action) = 'array'),
    (select c.default_roles from private.org_permission_catalog() c where c.key = p_action),
    '{}'::public.org_role[])
$$;

-- Vérifie et nettoie un réglage des droits ; refuse ce qui casserait la séparation des
-- fonctions ou laisserait une action sans personne.
create or replace function private.org_permissions_clean(p_value jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  roles public.org_role[];
  clean jsonb := '{}'::jsonb;
  pair text[];
  a public.org_role[];
  b public.org_role[];
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'Droits invalides.' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_value) loop
    if not exists (select 1 from private.org_permission_catalog() c where c.key = k) then
      raise exception 'Action inconnue : %.', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) <> 'array' then
      raise exception 'Droits invalides pour « % ».', k using errcode = '22023';
    end if;
    begin
      select coalesce(array_agg(distinct x::public.org_role), '{}') into roles
      from jsonb_array_elements_text(v) x;
    exception when invalid_text_representation then
      raise exception 'Rôle inconnu dans « % ».', k using errcode = '22023';
    end;
    if cardinality(roles) = 0 then
      raise exception 'Chaque action doit rester ouverte à au moins un rôle (« % »).',
        (select c.label from private.org_permission_catalog() c where c.key = k)
        using errcode = '22023';
    end if;
    clean := clean || jsonb_build_object(k, to_jsonb(roles));
  end loop;

  -- Séparation des fonctions : contrôle, décision et paiement par des rôles distincts.
  foreach pair slice 1 in array array[
    array['expense_verify', 'expense_decide'],
    array['expense_decide', 'expense_pay'],
    array['financing_decide', 'financing_disburse']] loop
    select coalesce(
      (select array_agg(x::public.org_role) from jsonb_array_elements_text(clean -> pair[1]) x),
      (select c.default_roles from private.org_permission_catalog() c where c.key = pair[1])) into a;
    select coalesce(
      (select array_agg(x::public.org_role) from jsonb_array_elements_text(clean -> pair[2]) x),
      (select c.default_roles from private.org_permission_catalog() c where c.key = pair[2])) into b;
    if a && b then
      raise exception 'Séparation des fonctions : un même rôle ne peut pas « % » et « % ».',
        lower((select c.label from private.org_permission_catalog() c where c.key = pair[1])),
        lower((select c.label from private.org_permission_catalog() c where c.key = pair[2]))
        using errcode = '22023';
    end if;
  end loop;
  return clean;
end;
$$;

-- Tableau des droits pour l'écran Paramètres.
create or replace function public.org_permissions(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
begin
  perform private.require_sees_finance(o.id);
  return jsonb_build_object(
    'canEdit', private.is_org_admin(o.id),
    'actions', (
      select jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label,
        'description', c.description,
        'roles', to_jsonb(private.org_roles_for(o.id, c.key)),
        'defaultRoles', to_jsonb(c.default_roles)) order by c.rank)
      from private.org_permission_catalog() c));
end;
$$;
revoke all on function public.org_permissions(text) from public, anon;
grant execute on function public.org_permissions(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Fonctions en vigueur, rôles désormais lus dans le réglage
-- ---------------------------------------------------------------------------

create or replace function public.org_allocation_rule_add(p_slug text, p_kind org_rule_kind, p_structure uuid, p_fund_kind org_fund_kind, p_rate_bp integer, p_amount integer, p_frequency org_fund_frequency, p_effective_from date, p_authority text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_org_roles(o.id, private.org_roles_for(o.id, 'common_fund'),
    'Seule l’administration générale ou financière fixe les règles de répartition.');
  v_authority text := nullif(btrim(coalesce(p_authority, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  v_label text;
begin
  perform private.inspect_input('authority', v_authority);
  perform private.inspect_input('note', v_note);
  if v_authority is null or char_length(v_authority) not between 3 and 120 then
    raise exception 'Indiquez l’autorité qui a validé la règle.' using errcode = '22023';
  end if;
  if p_effective_from is null or p_effective_from < current_date then
    raise exception 'La date de prise d’effet doit être aujourd’hui ou plus tard (les opérations passées ne sont pas recalculées).'
      using errcode = '22023';
  end if;
  if p_structure is not null and not exists (
    select 1 from public.org_structures s where s.id = p_structure and s.organization_id = o.id
  ) then
    raise exception 'Structure introuvable.' using errcode = 'P0002';
  end if;
  if p_kind = 'percent' then
    if p_fund_kind is null or p_rate_bp is null or p_rate_bp not between 0 and 10000 then
      raise exception 'Indiquez la nature des recettes et un pourcentage entre 0 et 100.'
        using errcode = '22023';
    end if;
  elsif p_amount is null or p_amount not between 0 and 100000000
        or p_frequency not in ('monthly', 'quarterly', 'yearly') then
    raise exception 'Indiquez le montant et la périodicité de la contribution fixe.'
      using errcode = '22023';
  end if;

  insert into public.org_allocation_rules (organization_id, structure_id, kind, fund_kind,
    rate_bp, amount, frequency, effective_from, authority, note, created_by)
  values (o.id, p_structure, p_kind,
    case when p_kind = 'percent' then p_fund_kind end,
    case when p_kind = 'percent' then p_rate_bp end,
    case when p_kind = 'fixed' then p_amount end,
    case when p_kind = 'fixed' then p_frequency end,
    p_effective_from, v_authority, v_note, uid)
  returning id into v_id;

  v_label := case when p_kind = 'percent'
    then format('%s %% des recettes « %s »', p_rate_bp / 100.0, p_fund_kind)
    else format('contribution fixe de %s', private.format_amount(p_amount)) end;
  perform private.audit(uid, 'org_rule_added',
    format('a fixé une règle du fonds commun : %s, à partir du %s (%s)', v_label,
      to_char(p_effective_from, 'DD/MM/YYYY'),
      coalesce((select s.name from public.org_structures s where s.id = p_structure),
               'toutes les structures')));
  return v_id;
end;
$function$
;


create or replace function public.org_common_receive(p_slug text, p_nature org_entry_nature, p_source_kind org_source_kind, p_user uuid, p_structure uuid, p_origin text, p_amount integer, p_method org_payment_method, p_reference text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_org_roles(o.id, private.org_roles_for(o.id, 'common_fund'),
    'Seule l’administration générale ou financière enregistre les versements au fonds commun.');
  v_origin text := nullif(btrim(coalesce(p_origin, '')), '');
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  s public.org_structures;
  v_entry uuid;
begin
  perform private.inspect_input('origin', v_origin);
  perform private.inspect_input('reference', v_reference);
  perform private.inspect_input('note', v_note);
  if p_nature not in ('contribution_volontaire', 'don') then
    raise exception 'Nature de versement invalide.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 100000000 then
    raise exception 'Montant invalide.' using errcode = '22023';
  end if;

  if p_source_kind = 'structure' then
    select * into s from public.org_structures where id = p_structure and organization_id = o.id;
    if not found then
      raise exception 'Structure introuvable.' using errcode = 'P0002';
    end if;
    if private.account_balance(o.id, 'structure', s.id) < p_amount then
      raise exception 'Solde insuffisant dans la caisse de « % » (%).', s.name,
        private.format_amount(private.account_balance(o.id, 'structure', s.id)::integer)
        using errcode = '22023';
    end if;
    v_entry := private.entry_create(o.id, p_nature, p_amount,
      format('Versement volontaire de « %s » au fonds commun', s.name),
      jsonb_build_object('structure_id', s.id, 'source_kind', 'structure', 'origin', s.name,
        'note', v_note, 'validated_by', uid));
    perform private.entry_move(v_entry, 'structure', s.id, 'common', null, p_amount);
  else
    if p_source_kind = 'membre' then
      if not exists (select 1 from public.organization_members m
                     where m.organization_id = o.id and m.user_id = p_user) then
        raise exception 'Ce membre est introuvable.' using errcode = 'P0002';
      end if;
      v_origin := private.full_name(p_user);
    elsif v_origin is null or char_length(v_origin) < 2 then
      raise exception 'Indiquez l’origine du versement (donateur).' using errcode = '22023';
    end if;
    if p_method is null then
      raise exception 'Indiquez le mode de paiement.' using errcode = '22023';
    end if;
    perform private.check_reference(o.id, p_method, v_reference);
    v_entry := private.entry_create(o.id, p_nature, p_amount,
      format('%s au fonds commun – %s',
        case when p_nature = 'don' then 'Don' else 'Contribution volontaire' end, v_origin),
      jsonb_build_object('source_kind', p_source_kind, 'source_user',
        case when p_source_kind = 'membre' then p_user end, 'origin', v_origin,
        'method', p_method, 'reference', v_reference, 'note', v_note, 'validated_by', uid));
    perform private.entry_move(v_entry, 'treasury', null, 'common', null, p_amount);
    if p_source_kind = 'membre' then
      perform private.notify(p_user, 'organization', o.short_name || ' – Fonds commun',
        format('Merci : votre contribution de %s au fonds commun a été enregistrée.',
          private.format_amount(p_amount)), null);
    end if;
  end if;

  perform private.audit(uid, 'org_common_entry',
    format('a enregistré %s de %s au fonds commun (%s)',
      case when p_nature = 'don' then 'un don' else 'une contribution volontaire' end,
      private.format_amount(p_amount), coalesce(s.name, v_origin)));
  return v_entry;
end;
$function$
;


create or replace function public.org_entry_cancel(p_entry uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e public.org_entries;
  uid uuid := private.require_uid();
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into e from public.org_entries where id = p_entry;
  if not found then
    raise exception 'Opération introuvable.' using errcode = 'P0002';
  end if;
  perform private.require_org_roles(e.organization_id, private.org_roles_for(e.organization_id, 'common_fund'),
    'Seule l’administration financière annule une opération.');
  if e.nature not in ('contribution_fixe', 'contribution_volontaire', 'don') then
    raise exception 'Cette opération s’annule depuis son paiement, sa dépense ou son financement.'
      using errcode = '22023';
  end if;
  if e.cancelled_at is not null then
    raise exception 'Cette opération est déjà annulée.' using errcode = '22023';
  end if;
  if e.created_by = uid then
    raise exception 'Une autre personne que l’auteur doit annuler cette opération.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  perform private.inspect_input('reason', reason);
  if reason is null or char_length(reason) > 200 then
    raise exception 'Indiquez le motif de l’annulation (200 caractères au plus).'
      using errcode = '22023';
  end if;
  perform private.entry_reverse(e.id, uid, reason);
  perform private.audit(uid, 'org_entry_cancelled',
    format('a annulé l’opération %s (%s) : %s', e.entry_number,
      private.format_amount(e.amount), reason));
end;
$function$
;


create or replace function public.org_common_view(p_slug text, p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_sees_finance(o.id);
  v_year integer := coalesce(p_year, extract(year from current_date)::int);
begin
  return jsonb_build_object(
    'year', v_year,
    'canManage', private.has_org_role(o.id, private.org_roles_for(o.id, 'common_fund')),
    'balance', private.account_balance(o.id, 'common'),
    'byNature', coalesce((
      select jsonb_object_agg(t.nature, t.total) from (
        select e.nature, sum(l.credit - l.debit) as total
        from public.org_entry_lines l join public.org_entries e on e.id = l.entry_id
        where e.organization_id = o.id and l.account = 'common'
          and e.nature <> 'annulation' and e.cancelled_at is null
          and extract(year from e.created_at) = v_year
        group by e.nature
      ) t
    ), '{}'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', to_char(gs.m, 'YYYY-MM'),
        'amount', coalesce((
          select sum(l.credit) from public.org_entry_lines l
          join public.org_entries e on e.id = l.entry_id
          where e.organization_id = o.id and l.account = 'common' and l.credit > 0
            and e.nature <> 'annulation' and e.cancelled_at is null
            and date_trunc('month', e.created_at) = gs.m), 0)) order by gs.m)
      from generate_series(make_date(v_year, 1, 1), make_date(v_year, 12, 1), interval '1 month') gs(m)
    ), '[]'::jsonb),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'status', s.status,
        'share', coalesce((select sum(e.amount) from public.org_entries e
          where e.structure_id = s.id and e.nature = 'part_fonds_commun' and e.cancelled_at is null
            and extract(year from e.created_at) = v_year), 0),
        'voluntary', coalesce((select sum(e.amount) from public.org_entries e
          where e.structure_id = s.id and e.nature = 'contribution_volontaire'
            and e.source_kind = 'structure' and e.cancelled_at is null
            and extract(year from e.created_at) = v_year), 0),
        'fixedDue', coalesce((select sum(d.amount) from private.fixed_dues(s.id, v_year) d), 0),
        'fixedPaid', coalesce((select sum(e.amount) from public.org_entries e
          where e.structure_id = s.id and e.nature = 'contribution_fixe' and e.cancelled_at is null
            and extract(year from e.period) = v_year), 0),
        'fixedPeriods', coalesce((select jsonb_agg(jsonb_build_object(
            'period', d.period, 'amount', d.amount,
            'paid', exists (select 1 from public.org_entries e where e.structure_id = s.id
              and e.nature = 'contribution_fixe' and e.period = d.period and e.cancelled_at is null))
            order by d.period)
          from private.fixed_dues(s.id, v_year) d), '[]'::jsonb),
        'balance', private.account_balance(o.id, 'structure', s.id)
      ) order by s.name)
      from public.org_structures s where s.organization_id = o.id and s.status <> 'archived'
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(private.rule_json(r) order by r.kind, r.effective_from desc, r.created_at desc)
      from public.org_allocation_rules r where r.organization_id = o.id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(private.entry_json(e) order by e.created_at desc)
      from (
        select e.* from public.org_entries e
        where e.organization_id = o.id and exists (
          select 1 from public.org_entry_lines l where l.entry_id = e.id and l.account = 'common')
        order by e.created_at desc limit 15
      ) e
    ), '[]'::jsonb)
  );
end;
$function$
;


create or replace function public.org_expense_verify(p_id uuid, p_ok boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_org_roles(x.organization_id, private.org_roles_for(x.organization_id, 'expense_verify'),
    'La vérification est faite par l’administration financière ou le contrôleur.');
  v_note text := private.clean_text('note', p_note, 500);
  v_available bigint := private.account_available(x.organization_id, x.account, x.structure_id);
begin
  if x.status <> 'submitted' then
    raise exception 'Cette demande n’est pas en attente de vérification.' using errcode = '22023';
  end if;
  if x.requested_by = uid then
    raise exception 'Vous ne pouvez pas vérifier votre propre demande.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  if p_ok then
    if v_available < x.amount_requested then
      raise exception 'Ressources insuffisantes : disponible %.',
        private.format_amount(v_available::integer) using errcode = '22023';
    end if;
    update public.org_expenses set status = 'verified', verified_by = uid, verified_at = now()
    where id = x.id;
    perform private.expense_event(x.id, 'verified', uid, null,
      coalesce(v_note, format('Disponible : %s', private.format_amount(v_available::integer))));
    perform private.notify(r.user_id, 'organization',
      (select o.short_name from public.organizations o where o.id = x.organization_id) || ' – Dépenses',
      format('Dépense %s vérifiée, en attente de votre décision.', x.number),
      '/espace/' || (select o.slug from public.organizations o where o.id = x.organization_id)
        || '/admin/depenses/' || x.id)
    from (select distinct r.user_id from public.organization_roles r
          where r.organization_id = x.organization_id and r.role in ('validator', 'org_admin')
            and r.user_id <> uid) r;
  else
    v_note := private.require_note(p_note, 'Indiquez ce qui manque ou pose problème.');
    update public.org_expenses set status = 'info_requested' where id = x.id;
    perform private.expense_event(x.id, 'info_requested', uid, null, v_note);
    perform private.notify(x.requested_by, 'organization',
      private.structure_label(x.structure_id),
      format('Dépense %s : informations demandées. %s', x.number, v_note), null);
  end if;
  perform private.audit(uid, 'org_expense_decided',
    format('a %s la dépense %s', case when p_ok then 'vérifié' else 'demandé des précisions sur' end,
      x.number));
end;
$function$
;


create or replace function public.org_expense_decide(p_id uuid, p_decision text, p_amount integer, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_org_roles(x.organization_id, private.org_roles_for(x.organization_id, 'expense_decide'),
    'La décision revient à l’autorité centrale de validation.');
  settings jsonb := private.org_settings(x.organization_id);
  v_note text := private.require_note(p_note, 'Justifiez la décision.');
  v_amount integer := coalesce(p_amount, x.amount_requested);
  v_status public.org_expense_status;
begin
  if not (x.status = 'verified'
          or (x.status = 'submitted' and not (settings ->> 'expenseNeedsVerification')::boolean)) then
    raise exception 'Cette demande doit d’abord être vérifiée par le service financier.'
      using errcode = '22023';
  end if;
  if x.requested_by = uid or x.verified_by = uid then
    raise exception 'Vous avez déjà demandé ou vérifié cette dépense : une autre personne décide.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;

  if p_decision = 'approve' then
    if v_amount < 100 or v_amount > x.amount_requested then
      raise exception 'Le montant approuvé doit être compris entre 100 FCFA et le montant demandé.'
        using errcode = '22023';
    end if;
    if v_amount > (settings ->> 'expenseCeiling')::integer
       and not private.is_org_admin(x.organization_id) then
      raise exception 'Au-delà du plafond de %, seule l’administration générale approuve.',
        private.format_amount((settings ->> 'expenseCeiling')::integer)
        using errcode = '42501', hint = 'access_denied:ceiling';
    end if;
    if private.account_available(x.organization_id, x.account, x.structure_id) < v_amount then
      raise exception 'Ressources insuffisantes dans la caisse concernée.' using errcode = '22023';
    end if;
    v_status := 'approved';
    update public.org_expenses
    set status = 'approved', amount_approved = v_amount, decided_by = uid, decided_at = now(),
        decision_note = v_note
    where id = x.id;
  elsif p_decision = 'reject' then
    v_status := 'rejected';
    update public.org_expenses
    set status = 'rejected', decided_by = uid, decided_at = now(), decision_note = v_note
    where id = x.id;
  elsif p_decision = 'info' then
    v_status := 'info_requested';
    update public.org_expenses set status = 'info_requested' where id = x.id;
  else
    raise exception 'Décision invalide.' using errcode = '22023';
  end if;

  perform private.expense_event(x.id, v_status, uid,
    case when v_status = 'approved' then v_amount end, v_note);
  perform private.notify(x.requested_by, 'organization',
    coalesce(private.structure_label(x.structure_id),
      (select o.short_name from public.organizations o where o.id = x.organization_id)),
    format('Dépense %s %s. %s', x.number, case v_status
      when 'approved' then case when v_amount < x.amount_requested
        then 'approuvée partiellement (' || private.format_amount(v_amount) || ')'
        else 'approuvée' end
      when 'rejected' then 'rejetée'
      else ': informations demandées' end, v_note), null);
  perform private.audit(uid, 'org_expense_decided',
    format('a %s la dépense %s', case v_status when 'approved' then 'approuvé'
      when 'rejected' then 'rejeté' else 'demandé des précisions sur' end, x.number));
end;
$function$
;


create or replace function public.org_expense_view(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_uid();
  settings jsonb := private.org_settings(x.organization_id);
  needs_check boolean := (settings ->> 'expenseNeedsVerification')::boolean;
begin
  if not private.expense_visible(x) then
    raise exception 'Accès refusé.' using errcode = '42501', hint = 'access_denied:expense';
  end if;
  return private.expense_json(x) || jsonb_build_object(
    'balance', private.account_balance(x.organization_id, x.account,
      case when x.account = 'structure' then x.structure_id end),
    'available', private.account_available(x.organization_id, x.account, x.structure_id),
    'ceiling', (settings ->> 'expenseCeiling')::integer,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('status', e.status, 'actor', private.full_name(e.actor_id),
        'amount', e.amount, 'note', e.note, 'at', e.at) order by e.at)
      from public.org_expense_events e where e.expense_id = x.id
    ), '[]'::jsonb),
    'documents', private.documents_json('expense', x.id),
    'can', jsonb_build_object(
      'verify', x.status = 'submitted' and needs_check and x.requested_by is distinct from uid
        and private.has_org_role(x.organization_id, private.org_roles_for(x.organization_id, 'expense_verify')),
      'decide', (x.status = 'verified' or (x.status = 'submitted' and not needs_check))
        and x.requested_by is distinct from uid and x.verified_by is distinct from uid
        and private.has_org_role(x.organization_id, private.org_roles_for(x.organization_id, 'expense_decide')),
      'reply', x.status = 'info_requested' and x.requested_by = uid,
      'commit', x.status = 'approved' and private.expense_payer(x),
      'pay', x.status in ('approved', 'committed') and private.expense_payer(x)
        and x.decided_by is distinct from uid,
      'justify', x.status = 'paid' and (x.requested_by = uid or private.expense_payer(x)),
      'cancel', x.status in ('submitted', 'info_requested', 'verified') and x.requested_by = uid,
      'attach', x.status not in ('rejected', 'cancelled')
        and (x.requested_by = uid or private.expense_payer(x))
    )
  );
end;
$function$
;


create or replace function private.expense_payer(x org_expenses)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.has_org_role(x.organization_id, private.org_roles_for(x.organization_id, 'expense_pay'))
    or (x.account = 'structure' and exists (
      select 1 from public.structure_roles r
      where r.user_id = private.active_uid() and r.role in ('responsable', 'tresorier')
        and r.structure_id in (select a.id from private.structure_ancestors(x.structure_id) a)))
$function$
;


create or replace function public.org_financing_check(p_id uuid, p_ok boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id, private.org_roles_for(f.organization_id, 'financing_review'),
    'Réservé au responsable des projets ou à l’administration.');
  v_note text := private.clean_text('note', p_note, 2000);
begin
  if f.status <> 'submitted' then
    raise exception 'Ce dossier n’attend pas de vérification.' using errcode = '22023';
  end if;
  if f.user_id = uid then
    raise exception 'Vous ne pouvez pas traiter votre propre demande.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  if p_ok then
    update public.org_financings set status = 'checked', checked_by = uid, checked_at = now()
    where id = f.id;
    perform private.financing_event(f.id, 'checked', uid, null, v_note);
    perform private.financing_notify(f, 'dossier complet, en cours d’évaluation.');
  else
    v_note := private.require_note(p_note, 'Indiquez ce qui manque au dossier.');
    update public.org_financings set status = 'incomplete' where id = f.id;
    perform private.financing_event(f.id, 'incomplete', uid, null, v_note);
    perform private.financing_notify(f, 'dossier à compléter. ' || v_note);
  end if;
end;
$function$
;


create or replace function public.org_financing_evaluate(p_id uuid, p_scores jsonb, p_note text, p_social_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id, private.org_roles_for(f.organization_id, 'financing_review'),
    'Réservé au responsable des projets ou à l’administration.');
  maxima jsonb := '{"pertinence": 15, "viabilite": 15, "faisabilite": 10, "impact": 10,
                    "budget": 5, "capacite": 5}';
  k text;
  v integer;
  total integer := 0;
  clean jsonb := '{}';
  assiduity jsonb := private.member_assiduity(f.organization_id, f.user_id);
begin
  if f.status not in ('checked', 'evaluated') then
    raise exception 'Le dossier doit être vérifié avant l’évaluation.' using errcode = '22023';
  end if;
  if f.user_id = uid then
    raise exception 'Vous ne pouvez pas évaluer votre propre demande.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  for k in select jsonb_object_keys(maxima) loop
    v := (p_scores ->> k)::integer;
    if v is null or v < 0 or v > (maxima ->> k)::integer then
      raise exception 'Note « % » : entre 0 et %.', k, maxima ->> k using errcode = '22023';
    end if;
    clean := clean || jsonb_build_object(k, v);
    total := total + v;
  end loop;
  update public.org_financings
  set status = 'evaluated', scores = clean, project_score = total,
      assiduity_score = (assiduity ->> 'score')::integer,
      evaluation_note = private.clean_text('note', p_note, 2000),
      social_note = private.clean_text('social', p_social_note, 1000),
      evaluated_by = uid, evaluated_at = now()
  where id = f.id;
  perform private.financing_event(f.id, 'evaluated', uid, null,
    format('Note : %s/100 (assiduité %s/40, projet %s/60)',
      total + (assiduity ->> 'score')::integer, assiduity ->> 'score', total));
  perform private.notify(r.user_id, 'organization',
    (select o.short_name from public.organizations o where o.id = f.organization_id) || ' – Financements',
    format('Demande %s évaluée : en attente de la décision du comité.', f.number),
    '/espace/' || (select o.slug from public.organizations o where o.id = f.organization_id)
      || '/financements/' || f.id)
  from (select distinct r.user_id from public.organization_roles r
        where r.organization_id = f.organization_id and r.role in ('validator', 'org_admin')
          and r.user_id <> uid) r;
  return jsonb_build_object('assiduity', (assiduity ->> 'score')::integer, 'project', total);
end;
$function$
;


create or replace function public.org_financing_decide(p_id uuid, p_approve boolean, p_amount integer, p_conditions text, p_account org_account, p_structure uuid, p_is_loan boolean, p_repayment_count integer, p_first_due date, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id, private.org_roles_for(f.organization_id, 'financing_decide'),
    'La décision revient au comité (autorité de validation ou administration générale).');
  v_note text := private.require_note(p_note, 'Motivez la décision.');
  v_conditions text := private.clean_text('conditions', p_conditions, 2000);
  i integer;
  part integer;
  v_structure uuid := case when p_account = 'structure' then coalesce(p_structure, f.structure_id) end;
begin
  if f.status <> 'evaluated' then
    raise exception 'Le dossier doit être évalué avant la décision.' using errcode = '22023';
  end if;
  if f.user_id = uid or f.evaluated_by = uid then
    raise exception 'Vous avez déposé ou évalué ce dossier : une autre personne décide.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;

  if not p_approve then
    update public.org_financings
    set status = 'rejected', decided_by = uid, decided_at = now(), decision_note = v_note
    where id = f.id;
    perform private.financing_event(f.id, 'rejected', uid, null, v_note);
    perform private.financing_notify(f, 'demande non retenue. ' || v_note);
    perform private.audit(uid, 'org_financing_decided',
      format('a rejeté la demande de financement %s', f.number));
    return;
  end if;

  if coalesce(p_amount, 0) < 1000 or p_amount > f.amount_requested then
    raise exception 'Le montant accordé doit être compris entre 1 000 FCFA et le montant demandé.'
      using errcode = '22023';
  end if;
  if p_account not in ('structure', 'common') then
    raise exception 'Choisissez la caisse qui finance.' using errcode = '22023';
  end if;
  if private.account_available(f.organization_id, p_account, v_structure) < p_amount then
    raise exception 'Ressources insuffisantes dans la caisse qui finance.' using errcode = '22023';
  end if;
  if coalesce(p_is_loan, false) and (coalesce(p_repayment_count, 0) not between 1 and 60
                                     or p_first_due is null or p_first_due <= current_date) then
    raise exception 'Prêt : indiquez le nombre d’échéances (1 à 60) et une première échéance future.'
      using errcode = '22023';
  end if;

  update public.org_financings
  set status = 'approved', decided_by = uid, decided_at = now(), decision_note = v_note,
      amount_granted = p_amount, conditions = v_conditions, is_loan = coalesce(p_is_loan, false),
      funding_account = p_account, funding_structure = v_structure
  where id = f.id;

  if coalesce(p_is_loan, false) then
    for i in 0 .. p_repayment_count - 1 loop
      part := p_amount / p_repayment_count
        + case when i = p_repayment_count - 1 then p_amount % p_repayment_count else 0 end;
      insert into public.org_financing_repayments (financing_id, due_date, amount_due)
      values (f.id, (p_first_due + make_interval(months => i))::date, part);
    end loop;
  end if;

  if f.nature in ('projet_economique', 'initiative_collective') then
    insert into public.org_projects (organization_id, structure_id, financing_id, title,
      manager_id, manager_name, objectives, budget, funding_sources, beneficiaries, status,
      created_by)
    values (f.organization_id, f.structure_id, f.id, f.title, f.user_id,
      private.full_name(f.user_id), f.objectives, p_amount,
      'Financement ' || f.number, f.beneficiaries, 'approved', uid);
  end if;

  perform private.financing_event(f.id, 'approved', uid, p_amount, v_note);
  perform private.financing_notify(f, format('financement accordé : %s. %s',
    private.format_amount(p_amount), coalesce(v_conditions, '')));
  perform private.audit(uid, 'org_financing_decided',
    format('a accordé %s pour la demande %s', private.format_amount(p_amount), f.number));
end;
$function$
;


create or replace function public.org_financing_disburse(p_id uuid, p_amount integer, p_method org_payment_method, p_reference text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id, private.org_roles_for(f.organization_id, 'financing_disburse'),
    'Le décaissement est fait par l’administration financière.');
  v_reference text := private.clean_text('reference', p_reference, 80);
  v_entry uuid;
begin
  if f.status not in ('approved', 'active') then
    raise exception 'Ce financement n’est pas à décaisser.' using errcode = '22023';
  end if;
  if f.decided_by = uid then
    raise exception 'Vous avez décidé ce financement : une autre personne décaisse.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  if coalesce(p_amount, 0) <= 0 or f.amount_disbursed + p_amount > f.amount_granted then
    raise exception 'Reste à décaisser : %.',
      private.format_amount(f.amount_granted - f.amount_disbursed) using errcode = '22023';
  end if;
  if p_method is null then
    raise exception 'Indiquez le mode de paiement.' using errcode = '22023';
  end if;
  perform private.check_reference(f.organization_id, p_method, v_reference);
  if private.account_balance(f.organization_id, f.funding_account, f.funding_structure) < p_amount then
    raise exception 'Solde insuffisant dans la caisse qui finance.' using errcode = '22023';
  end if;
  v_entry := private.entry_create(f.organization_id, 'decaissement', p_amount,
    format('Financement %s – %s', f.number, private.full_name(f.user_id)),
    jsonb_build_object('structure_id', f.structure_id, 'financing_id', f.id,
      'source_user', f.user_id, 'origin', private.full_name(f.user_id), 'method', p_method,
      'reference', v_reference, 'note', private.clean_text('note', p_note, 300),
      'validated_by', f.decided_by));
  perform private.entry_move(v_entry, f.funding_account, f.funding_structure,
    'treasury', null, p_amount);
  update public.org_financings
  set status = 'active', amount_disbursed = amount_disbursed + p_amount
  where id = f.id;
  update public.org_projects set status = 'in_progress'
  where financing_id = f.id and status = 'approved';
  perform private.financing_event(f.id, 'active', uid, p_amount, 'Décaissement');
  perform private.financing_notify(f, format('%s décaissés.', private.format_amount(p_amount)));
  perform private.audit(uid, 'org_financing_paid',
    format('a décaissé %s pour le financement %s', private.format_amount(p_amount), f.number));
  return v_entry;
end;
$function$
;


create or replace function public.org_financing_repay(p_id uuid, p_amount integer, p_method org_payment_method, p_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id, private.org_roles_for(f.organization_id, 'financing_repay'),
    'Réservé à l’administration financière.');
  v_reference text := private.clean_text('reference', p_reference, 80);
  v_left integer := coalesce(p_amount, 0);
  v_open integer;
  r public.org_financing_repayments;
  part integer;
  v_entry uuid;
begin
  if not f.is_loan or f.status <> 'active' then
    raise exception 'Aucun remboursement attendu pour ce financement.' using errcode = '22023';
  end if;
  select coalesce(sum(x.amount_due - x.amount_paid), 0) into v_open
  from public.org_financing_repayments x where x.financing_id = f.id;
  if v_left <= 0 or v_left > v_open then
    raise exception 'Reste à rembourser : %.', private.format_amount(v_open) using errcode = '22023';
  end if;
  if p_method is null then
    raise exception 'Indiquez le mode de paiement.' using errcode = '22023';
  end if;
  perform private.check_reference(f.organization_id, p_method, v_reference);
  v_entry := private.entry_create(f.organization_id, 'remboursement', p_amount,
    format('Remboursement %s – %s', f.number, private.full_name(f.user_id)),
    jsonb_build_object('structure_id', f.structure_id, 'financing_id', f.id,
      'source_kind', 'membre', 'source_user', f.user_id, 'origin', private.full_name(f.user_id),
      'method', p_method, 'reference', v_reference, 'validated_by', uid));
  perform private.entry_move(v_entry, 'treasury', null, f.funding_account, f.funding_structure,
    p_amount);
  for r in select * from public.org_financing_repayments x
           where x.financing_id = f.id and x.amount_paid < x.amount_due
           order by x.due_date for update loop
    exit when v_left <= 0;
    part := least(v_left, r.amount_due - r.amount_paid);
    update public.org_financing_repayments
    set amount_paid = amount_paid + part,
        paid_at = case when amount_paid + part >= amount_due then now() end
    where id = r.id;
    v_left := v_left - part;
  end loop;
  update public.org_financings set amount_repaid = amount_repaid + p_amount where id = f.id;
  perform private.financing_event(f.id, 'active', uid, p_amount, 'Remboursement');
  perform private.financing_notify(f, format('remboursement de %s enregistré.',
    private.format_amount(p_amount)));
  return v_entry;
end;
$function$
;


create or replace function public.org_financing_close(p_id uuid, p_report text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id, private.org_roles_for(f.organization_id, 'financing_close'),
    'Réservé au responsable des projets ou à l’administration générale.');
  v_report text := private.clean_text('report', p_report, 5000);
begin
  if f.status <> 'active' then
    raise exception 'Seul un financement en cours se clôture.' using errcode = '22023';
  end if;
  if v_report is null or char_length(v_report) < 10 then
    raise exception 'Rédigez le rapport d’exécution (10 caractères au moins).' using errcode = '22023';
  end if;
  update public.org_financings set status = 'closed', final_report = v_report, closed_at = now()
  where id = f.id;
  perform private.financing_event(f.id, 'closed', uid, null, 'Rapport final déposé');
end;
$function$
;


create or replace function public.org_financing_view(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_uid();
  central boolean := private.sees_org_finance(f.organization_id);
  handles boolean := private.has_org_role(f.organization_id, private.org_roles_for(f.organization_id, 'financing_review'));
begin
  if not private.financing_visible(f) then
    raise exception 'Accès refusé.' using errcode = '42501', hint = 'access_denied:financing';
  end if;
  return private.financing_json(f) || jsonb_build_object(
    'description', f.description, 'budget', f.budget, 'durationMonths', f.duration_months,
    'objectives', f.objectives, 'beneficiaries', f.beneficiaries,
    'scores', f.scores, 'evaluationNote', case when central then f.evaluation_note end,
    'socialNote', case when central then f.social_note end,
    'decisionNote', f.decision_note, 'conditions', f.conditions,
    'fundingAccount', f.funding_account,
    'fundingStructureName', (select s.name from public.org_structures s
                             where s.id = f.funding_structure),
    'finalReport', f.final_report, 'closedAt', f.closed_at,
    'assiduity', case when central then private.member_assiduity(f.organization_id, f.user_id) end,
    'commonAvailable', case when central then
      private.account_available(f.organization_id, 'common') end,
    'structureAvailable', case when central then
      private.account_available(f.organization_id, 'structure', f.structure_id) end,
    'repayments', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'dueDate', r.due_date,
        'amountDue', r.amount_due, 'amountPaid', r.amount_paid, 'paidAt', r.paid_at)
        order by r.due_date)
      from public.org_financing_repayments r where r.financing_id = f.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('status', e.status, 'actor',
        case when central or e.actor_id = uid then private.full_name(e.actor_id) end,
        'amount', e.amount, 'note', e.note, 'at', e.at) order by e.at)
      from public.org_financing_events e where e.financing_id = f.id
    ), '[]'::jsonb),
    'projectId', (select p.id from public.org_projects p where p.financing_id = f.id limit 1),
    'documents', private.documents_json('financing', f.id),
    'can', jsonb_build_object(
      'check', f.status = 'submitted' and handles and f.user_id <> uid,
      'evaluate', f.status in ('checked', 'evaluated') and handles and f.user_id <> uid,
      'decide', f.status = 'evaluated' and f.user_id <> uid and f.evaluated_by is distinct from uid
        and private.has_org_role(f.organization_id, private.org_roles_for(f.organization_id, 'financing_decide')),
      'disburse', f.status in ('approved', 'active') and f.amount_disbursed < f.amount_granted
        and f.decided_by is distinct from uid
        and private.has_org_role(f.organization_id, private.org_roles_for(f.organization_id, 'financing_disburse')),
      'repay', f.status = 'active' and f.is_loan and f.amount_repaid < f.amount_granted
        and private.has_org_role(f.organization_id, private.org_roles_for(f.organization_id, 'financing_repay')),
      'close', f.status = 'active'
        and private.has_org_role(f.organization_id, private.org_roles_for(f.organization_id, 'financing_close')),
      'complete', f.status = 'incomplete' and f.user_id = uid,
      'withdraw', f.status in ('submitted', 'incomplete', 'checked', 'evaluated') and f.user_id = uid,
      'attach', f.status not in ('rejected', 'withdrawn', 'closed') and (f.user_id = uid or handles)
    )
  );
end;
$function$
;


create or replace function public.org_project_save(p_slug text, p_id uuid, p_structure uuid, p_title text, p_manager_name text, p_objectives text, p_budget integer, p_funding_sources text, p_start date, p_end date, p_schedule text, p_beneficiaries text, p_expected text, p_obtained text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  p public.org_projects;
  v_title text := private.clean_text('title', p_title, 120);
  v_id uuid := p_id;
begin
  if v_title is null or char_length(v_title) < 3 then
    raise exception 'Donnez un intitulé au projet.' using errcode = '22023';
  end if;
  if p_budget is not null and (p_budget < 0 or p_budget > 1000000000) then
    raise exception 'Budget invalide.' using errcode = '22023';
  end if;
  if p_start is not null and p_end is not null and p_end < p_start then
    raise exception 'La date de fin précède la date de début.' using errcode = '22023';
  end if;
  if p_id is null then
    if not exists (select 1 from public.org_structures s where s.id = p_structure
                   and s.organization_id = o.id) then
      raise exception 'Choisissez la structure porteuse.' using errcode = '22023';
    end if;
    if not (private.has_org_role(o.id, private.org_roles_for(o.id, 'projects'))
            or private.manages_structure(p_structure)) then
      raise exception 'Réservé aux responsables de la structure ou au responsable des projets.'
        using errcode = '42501', hint = 'access_denied:project';
    end if;
    insert into public.org_projects (organization_id, structure_id, title, manager_name,
      objectives, budget, funding_sources, start_date, end_date, schedule, beneficiaries,
      expected_results, obtained_results, created_by)
    values (o.id, p_structure, v_title, private.clean_text('manager', p_manager_name, 80),
      private.clean_text('objectives', p_objectives, 2000), p_budget,
      private.clean_text('sources', p_funding_sources, 500), p_start, p_end,
      private.clean_text('schedule', p_schedule, 2000),
      private.clean_text('beneficiaries', p_beneficiaries, 1000),
      private.clean_text('expected', p_expected, 2000),
      private.clean_text('obtained', p_obtained, 3000), uid)
    returning id into v_id;
    insert into public.org_project_updates (project_id, status, note, author_id)
    values (v_id, 'submitted', 'Projet soumis', uid);
  else
    p := private.require_project(p_id);
    if p.organization_id <> o.id or not private.project_editable(p) then
      raise exception 'Vous ne pouvez pas modifier ce projet.' using errcode = '42501',
        hint = 'access_denied:project';
    end if;
    if p.status = 'closed' then
      raise exception 'Ce projet est clôturé.' using errcode = '22023';
    end if;
    update public.org_projects
    set title = v_title, manager_name = private.clean_text('manager', p_manager_name, 80),
        objectives = private.clean_text('objectives', p_objectives, 2000), budget = p_budget,
        funding_sources = private.clean_text('sources', p_funding_sources, 500),
        start_date = p_start, end_date = p_end,
        schedule = private.clean_text('schedule', p_schedule, 2000),
        beneficiaries = private.clean_text('beneficiaries', p_beneficiaries, 1000),
        expected_results = private.clean_text('expected', p_expected, 2000),
        obtained_results = private.clean_text('obtained', p_obtained, 3000)
    where id = p.id;
  end if;
  perform private.audit(uid, 'org_project_saved',
    format('a %s le projet « %s »', case when p_id is null then 'créé' else 'modifié' end, v_title));
  return v_id;
end;
$function$
;


create or replace function public.org_projects_list(p_slug text, p_status org_project_status, p_structure uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
begin
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(private.project_json(p) order by p.updated_at desc)
      from public.org_projects p
      where p.organization_id = o.id and private.project_visible(p)
        and (p_status is null or p.status = p_status)
        and (p_structure is null or p.structure_id = p_structure)
    ), '[]'::jsonb),
    'canCreate', private.has_org_role(o.id, private.org_roles_for(o.id, 'projects'))
      or exists (select 1 from public.structure_roles r join public.org_structures s
                 on s.id = r.structure_id where r.user_id = uid and s.organization_id = o.id)
  );
end;
$function$
;


create or replace function public.organization_settings_update(p_slug text, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_uid();
  k text;
  v jsonb;
  clean jsonb := '{}'::jsonb;
  offsets int[];
  txt text;
begin
  if not private.is_org_admin(o.id) then
    raise exception 'Seule l’administration générale règle les paramètres.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Paramètres invalides.' using errcode = '22023';
  end if;

  for k, v in select * from jsonb_each(p_settings) loop
    case k
      when 'reminderOffsets' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 8 then
          raise exception 'Rappels : 8 délais au plus.' using errcode = '22023';
        end if;
        select coalesce(array_agg(distinct x::int order by x::int), '{}') into offsets
        from jsonb_array_elements_text(v) x;
        if exists (select 1 from unnest(offsets) d where d not between -30 and 60) then
          raise exception 'Rappels : chaque délai doit être entre 30 jours avant et 60 jours après l’échéance.'
            using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, to_jsonb(offsets));
      when 'expenseCeiling', 'financingMaxAmount' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 1000000000
           or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then
          raise exception 'Montant invalide pour « % ».', k using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, (v #>> '{}')::bigint);
      when 'financingMaxMonths' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 1 and 120 then
          raise exception 'Durée maximale : entre 1 et 120 mois.' using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, (v #>> '{}')::numeric::int);
      when 'expenseNeedsVerification' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'Valeur invalide pour la vérification des dépenses.' using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, v);
      when 'receiptFooter', 'membershipNote' then
        txt := nullif(btrim(coalesce(v #>> '{}', '')), '');
        perform private.inspect_input(k, txt);
        if char_length(coalesce(txt, '')) > 300 then
          raise exception 'Texte trop long (300 caractères au plus).' using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, coalesce(txt, ''));
      when 'permissions' then
        clean := clean || jsonb_build_object(k, private.org_permissions_clean(v));
      else
        raise exception 'Paramètre inconnu : %.', k using errcode = '22023';
    end case;
  end loop;

  update public.organizations set settings = settings || clean where id = o.id;
  perform private.audit(uid, 'org_settings_updated',
    format('a modifié les paramètres de « %s » (%s)', o.name,
      (select string_agg(x, ', ' order by x) from jsonb_object_keys(clean) x)));
  return private.org_settings(o.id);
end;
$function$
;

