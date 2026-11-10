-- Paramètres généraux de l'organisation (cahier § 4.3) et rôles centraux (§ 14).
--
-- - organization_settings / organization_settings_update : l'administration générale lit et
--   règle les paramètres (rappels, plafond des dépenses, financements, reçus). Seules les
--   clés connues sont acceptées, chacune vérifiée ;
-- - les rappels de cotisation suivent les délais réglés (J-5, J-2, jour J, J+3, J+7, J+15
--   par défaut, cahier § 9.2) au lieu de délais fixes ;
-- - nomination : libellés de l'autorité de validation et du responsable des projets.

-- ---------------------------------------------------------------------------
-- Nomination aux rôles centraux
-- ---------------------------------------------------------------------------

create or replace function private.org_role_label(p_role public.org_role)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'org_admin' then 'administrateur général'
    when 'finance_admin' then 'administrateur financier'
    when 'controller' then 'contrôleur financier'
    when 'validator' then 'membre de l’autorité de validation'
    when 'projects_manager' then 'responsable des projets'
  end
$$;

create or replace function public.organization_set_role(
  p_org uuid, p_phone text, p_role public.org_role, p_grant boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_organization(p_org);
  target uuid := private.account_by_phone(p_phone);
  label text := private.org_role_label(p_role);
begin
  if not (private.is_super_admin()
          or (p_role <> 'org_admin' and private.is_org_admin(o.id))) then
    raise exception 'Vous ne pouvez pas attribuer ce rôle.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;

  if p_grant then
    insert into public.organization_roles (organization_id, user_id, role)
    values (o.id, target, p_role)
    on conflict do nothing;
    if found then
      perform private.notify(target, 'organization',
        o.short_name || ' : nouveau rôle',
        format('Vous êtes désormais %s de l’espace %s.', label, o.name),
        '/espace/' || o.slug || '/admin');
    end if;
  else
    if p_role = 'org_admin' and target = uid then
      raise exception 'Vous ne pouvez pas retirer votre propre rôle.' using errcode = '22023';
    end if;
    delete from public.organization_roles
    where organization_id = o.id and user_id = target and role = p_role;
  end if;

  perform private.audit(uid, 'org_role_changed',
    format('%s le rôle « %s » de %s dans « %s »',
      case when p_grant then 'a donné' else 'a retiré' end, label,
      private.full_name(target), o.name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Paramètres
-- ---------------------------------------------------------------------------

create or replace function public.organization_settings(p_slug text)
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
    'settings', private.org_settings(o.id),
    'canEdit', private.is_org_admin(o.id)
  );
end;
$$;

create or replace function public.organization_settings_update(p_slug text, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.organization_settings(text),
  public.organization_settings_update(text, jsonb) from public, anon;
grant execute on function public.organization_settings(text),
  public.organization_settings_update(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Rappels de cotisation aux délais réglés
-- ---------------------------------------------------------------------------

create or replace function private.org_send_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  sent integer := 0;
begin
  perform private.org_generate_all();
  for r in
    select i.id, i.user_id, i.due_date, i.amount_due - i.amount_paid as left_amount,
      f.name as fund_name, f.structure_id, o.slug,
      (current_date - i.due_date) as offset_days
    from public.org_installments i
    join public.org_funds f on f.id = i.fund_id
    join public.org_structures s on s.id = f.structure_id
    join public.organizations o on o.id = s.organization_id
    where i.exempted_at is null and i.amount_paid < i.amount_due
      and (current_date - i.due_date) in (
        select x::int from jsonb_array_elements_text(
          private.org_settings(o.id) -> 'reminderOffsets') x)
      and not o.is_suspended and s.status = 'active'
      and exists (select 1 from public.structure_members sm
                  where sm.structure_id = s.id and sm.user_id = i.user_id and sm.status = 'active')
      and not exists (select 1 from public.org_reminders x
                      where x.installment_id = i.id and x.offset_days = (current_date - i.due_date))
  loop
    insert into public.org_reminders (installment_id, offset_days) values (r.id, r.offset_days);
    perform private.notify(r.user_id, 'reminder', private.structure_label(r.structure_id),
      case
        when r.offset_days < 0 then format('Votre cotisation « %s » de %s est due le %s.',
          r.fund_name, private.format_amount(r.left_amount), to_char(r.due_date, 'DD/MM/YYYY'))
        when r.offset_days = 0 then format('Votre cotisation « %s » de %s est due aujourd’hui.',
          r.fund_name, private.format_amount(r.left_amount))
        else format('Votre cotisation « %s » du %s est en retard : il reste %s à payer.',
          r.fund_name, to_char(r.due_date, 'DD/MM/YYYY'), private.format_amount(r.left_amount))
      end,
      '/espace/' || r.slug || '/cotisations');
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;
