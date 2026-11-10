-- Tableau de bord central (cahier § 2.3, § 6.6, § 13.1) : membres à jour et en retard,
-- taux de recouvrement, caisses en fonctionnement, fonds commun, dépenses, financements,
-- projets. Réservé aux rôles centraux (consultation des finances).

create or replace function public.organization_overview(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  expected bigint;
  paid bigint;
begin
  perform private.require_sees_finance(o.id);

  select coalesce(sum(i.amount_due), 0), coalesce(sum(i.amount_paid), 0)
  into expected, paid
  from public.org_installments i
  join public.org_funds f on f.id = i.fund_id
  join public.org_structures s on s.id = f.structure_id
  where s.organization_id = o.id and i.exempted_at is null and i.due_date <= current_date;

  return jsonb_build_object(
    'members', (select count(*) from public.organization_members m
                where m.organization_id = o.id and m.status = 'active'),
    'lateMembers', (select count(distinct i.user_id) from public.org_installments i
      join public.org_funds f on f.id = i.fund_id
      join public.org_structures s on s.id = f.structure_id
      where s.organization_id = o.id and i.exempted_at is null
        and i.due_date < current_date and i.amount_paid < i.amount_due),
    'partialMembers', (select count(distinct i.user_id) from public.org_installments i
      join public.org_funds f on f.id = i.fund_id
      join public.org_structures s on s.id = f.structure_id
      where s.organization_id = o.id and i.exempted_at is null
        and i.amount_paid > 0 and i.amount_paid < i.amount_due),
    'structures', (select count(*) from public.org_structures s
                   where s.organization_id = o.id and s.status = 'active'),
    'funds', (select count(*) from public.org_funds f
              join public.org_structures s on s.id = f.structure_id
              where s.organization_id = o.id and not f.is_closed),
    'expected', expected,
    'paid', paid,
    'recoveryRate', case when expected = 0 then null else round(100.0 * paid / expected) end,
    'common', jsonb_build_object(
      'balance', private.account_balance(o.id, 'common'),
      'contributions', coalesce((select sum(l.credit) from public.org_entry_lines l
        join public.org_entries e on e.id = l.entry_id
        where e.organization_id = o.id and l.account = 'common' and l.credit > 0
          and e.nature <> 'annulation' and e.cancelled_at is null), 0)),
    'expenses', jsonb_build_object(
      'pending', (select count(*) from public.org_expenses x where x.organization_id = o.id
                  and x.status in ('submitted', 'info_requested', 'verified')),
      'approved', (select coalesce(sum(x.amount_approved), 0) from public.org_expenses x
                   where x.organization_id = o.id
                     and x.status in ('approved', 'committed', 'paid', 'closed')),
      'paid', (select coalesce(sum(x.amount_paid), 0) from public.org_expenses x
               where x.organization_id = o.id)),
    'financings', jsonb_build_object(
      'pending', (select count(*) from public.org_financings f where f.organization_id = o.id
                  and f.status in ('submitted', 'incomplete', 'checked', 'evaluated')),
      'granted', (select coalesce(sum(f.amount_granted), 0) from public.org_financings f
                  where f.organization_id = o.id and f.status in ('approved', 'active', 'closed'))),
    'projects', jsonb_build_object(
      'inProgress', (select count(*) from public.org_projects p where p.organization_id = o.id
                     and p.status in ('approved', 'in_progress')),
      'total', (select count(*) from public.org_projects p where p.organization_id = o.id))
  );
end;
$$;

revoke all on function public.organization_overview(text) from public, anon;
grant execute on function public.organization_overview(text) to authenticated;
