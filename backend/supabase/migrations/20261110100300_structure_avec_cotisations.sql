-- Création d'une structure avec ses cotisations en une seule opération (demande du
-- 2026-11-10) : l'admin général indique, en créant la structure, la cotisation
-- périodique et les frais d'adhésion. Les caisses correspondantes sont créées dans la
-- même transaction (si l'une échoue, rien n'est créé). D'autres caisses pourront être
-- ajoutées ensuite depuis la page de la structure.
create or replace function public.structure_create_with_funds(
  p_org uuid,
  p_name text,
  p_type public.structure_type,
  p_parent uuid,
  p_description text,
  p_contact_phone text,
  p_logo text,
  p_contribution integer,
  p_frequency public.org_fund_frequency,
  p_due_day integer,
  p_start_date date,
  p_membership_fee integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  structure_id uuid;
  label text;
begin
  structure_id := public.structure_save(p_org, null, p_name, p_type, p_parent, p_description,
    p_contact_phone, p_logo);

  if coalesce(p_contribution, 0) > 0 then
    label := case coalesce(p_frequency, 'monthly')
      when 'quarterly' then 'Cotisation trimestrielle'
      when 'yearly' then 'Cotisation annuelle'
      else 'Cotisation mensuelle' end;
    perform public.org_fund_save(structure_id, null, label, 'cotisation', p_contribution,
      coalesce(p_frequency, 'monthly'), coalesce(p_start_date, current_date),
      coalesce(p_due_day, 5), null);
  end if;

  if coalesce(p_membership_fee, 0) > 0 then
    perform public.org_fund_save(structure_id, null, 'Frais d’adhésion', 'adhesion',
      p_membership_fee, 'once', coalesce(p_start_date, current_date), 5, null);
  end if;

  return structure_id;
end;
$$;

revoke all on function public.structure_create_with_funds(uuid, text, public.structure_type, uuid,
  text, text, text, integer, public.org_fund_frequency, integer, date, integer) from public, anon;
grant execute on function public.structure_create_with_funds(uuid, text, public.structure_type,
  uuid, text, text, text, integer, public.org_fund_frequency, integer, date, integer)
  to authenticated;
