-- Tous les paiements de cotisation de l'organisation sur une seule page (Administration →
-- Paiements). Chacun ne voit que les structures dont il peut consulter les caisses :
-- toutes pour l'admin général, l'admin financier et le contrôleur ; les siennes (et celles
-- qui en dépendent) pour un responsable ou un trésorier. 50 lignes par page, avec les
-- totaux de la sélection (paiements annulés exclus des totaux).
create or replace function public.organization_payments_page(
  p_slug text,
  p_structure uuid default null,
  p_method public.org_payment_method default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  visible uuid[];
  result jsonb;
  summary jsonb;
begin
  select coalesce(array_agg(s.id), '{}') into visible
  from public.org_structures s
  where s.organization_id = o.id and private.views_structure_money(s.id);
  if cardinality(visible) = 0 then
    raise exception 'Vous n’avez accès à aucune caisse de cette organisation.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;

  with filtered as (
    select pay.*, f.name as fund_name, f.kind as fund_kind, s.id as structure_id,
      s.name as structure_name, p.first_name, p.last_name, p.phone,
      om.member_number
    from public.org_payments pay
    join public.org_funds f on f.id = pay.fund_id
    join public.org_structures s on s.id = f.structure_id
    join public.profiles p on p.id = pay.user_id
    left join public.organization_members om
      on om.organization_id = o.id and om.user_id = pay.user_id
    where s.id = any (visible)
      and (p_structure is null or s.id = p_structure)
      and (p_method is null or pay.method = p_method)
      and (p_from is null or pay.created_at >= p_from)
      and (p_to is null or pay.created_at < p_to + 1)
      and (q is null
        or lower(p.first_name || ' ' || p.last_name) like '%' || q || '%'
        or lower(p.last_name || ' ' || p.first_name) like '%' || q || '%'
        or lower(pay.receipt_number) like '%' || q || '%'
        or lower(coalesce(pay.reference, '')) like '%' || q || '%'
        or lower(coalesce(om.member_number, '')) like '%' || q || '%'
        or (q ~ '[0-9]' and p.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%'))
  )
  select
    jsonb_build_object(
      'count', count(*),
      'amount', coalesce(sum(amount) filter (where cancelled_at is null), 0),
      'cancelledCount', count(*) filter (where cancelled_at is not null),
      'byMethod', coalesce((
        select jsonb_object_agg(m.method, m.total)
        from (select method, sum(amount) as total from filtered
              where cancelled_at is null group by method) m
      ), '{}'::jsonb)
    ),
    coalesce((
      select jsonb_agg(row_json order by created_at desc)
      from (
        select x.created_at, jsonb_build_object(
          'id', x.id, 'createdAt', x.created_at, 'amount', x.amount, 'method', x.method,
          'reference', x.reference, 'receiptNumber', x.receipt_number,
          'fundId', x.fund_id, 'fundName', x.fund_name, 'fundKind', x.fund_kind,
          'structureId', x.structure_id, 'structureName', x.structure_name,
          'userId', x.user_id, 'firstName', x.first_name, 'lastName', x.last_name,
          'phone', x.phone, 'memberNumber', x.member_number,
          'recordedBy', private.full_name(x.recorded_by),
          'cancelledAt', x.cancelled_at, 'cancelReason', x.cancel_reason
        ) as row_json
        from filtered x
        order by x.created_at desc
        offset greatest(coalesce(p_offset, 0), 0)
        limit 50
      ) page
    ), '[]'::jsonb)
  into summary, result
  from filtered;

  return jsonb_build_object('rows', result, 'summary', summary, 'pageSize', 50);
end;
$$;

revoke all on function public.organization_payments_page(text, uuid, public.org_payment_method,
  date, date, text, integer) from public, anon;
grant execute on function public.organization_payments_page(text, uuid, public.org_payment_method,
  date, date, text, integer) to authenticated;
