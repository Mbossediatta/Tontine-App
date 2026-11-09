-- Annonce aux membres : la période de service de la plateforme passe à une part d'une
-- cotisation (suite de …_periode_service_pourcentage.sql et …_groupes_demarres.sql).
--
-- Une notification par membre et par groupe concerné, envoyée une seule fois (dans
-- l'application et en push sur le téléphone, via le déclencheur des notifications ; pas de
-- SMS). Texte en français ou en wolof selon la langue du membre.
--
-- Groupes concernés : en cours ou pas encore démarrés, avec une période de service, dont
-- le pourcentage est désormais inférieur à 100 % (les groupes dont la période de service a
-- déjà été payée sont restés à 100 % : rien à leur annoncer).

insert into public.notifications (user_id, type, title, body, link)
select
  u.user_id,
  'announcement',
  left(case when p.language = 'wo' then 'Xibaar bu baax · ' else 'Bonne nouvelle · ' end
       || g.name, 120),
  left(case
    when p.language = 'wo' then format(
      '%s : jamonoy liggéeyu Calebasse, ci mujjug cycle bi, dafay wàcc ba %s %% ci natt bi. '
      || 'Dinga fey %s ci pàcc bu nekk, te du %s.',
      g.name, g.platform_share_percent,
      private.format_amount(round(g.contribution_amount * g.platform_share_percent / 100.0)::integer
        * g.turn_length),
      private.format_amount(g.contribution_amount * g.turn_length))
    else format(
      '%s : la période de service Calebasse, en fin de cycle, passe à %s %% d’une cotisation. '
      || 'Vous paierez %s par part pour cette période, au lieu de %s.',
      g.name, g.platform_share_percent,
      private.format_amount(round(g.contribution_amount * g.platform_share_percent / 100.0)::integer
        * g.turn_length),
      private.format_amount(g.contribution_amount * g.turn_length))
  end, 1000),
  '/groupes/' || g.id
from public.groups g
join (
  select distinct m.group_id, m.user_id
  from public.memberships m
  where m.status = 'active'
) u on u.group_id = g.id
join public.profiles p on p.id = u.user_id
where g.reserve_final_turn
  and g.platform_share_percent < 100
  and g.status in ('draft', 'active')
  and g.archived_at is null
  and p.deleted_at is null;
