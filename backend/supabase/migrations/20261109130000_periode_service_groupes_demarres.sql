-- Période de service à pourcentage : aussi pour les groupes déjà démarrés (décision du
-- 9 novembre 2026, complète …_periode_service_pourcentage.sql).
--
-- Chaque groupe prend le réglage actuel (Paramètres › Règles, 50 % par défaut), et la
-- cagnotte de sa période de service non encore versée est recalculée.
--
-- Exception : un groupe dont la période de service a déjà reçu un paiement (réussi ou en
-- cours) ou a déjà été versée garde son pourcentage ; changer la règle en cours de route
-- rendrait ces paiements incohérents (trop-perçus).

-- Groupes à passer au réglage, avec leur ancien pourcentage (pour recalculer la cagnotte).
create temporary table service_switch on commit drop as
select g.id, g.platform_share_percent as old_percent
from public.groups g
where g.platform_share_percent <> private.platform_share_setting()
  and not exists (
    select 1 from public.rounds r
    where r.group_id = g.id
      and r.recipient_type = 'platform'
      and (
        r.status = 'paid_out'
        or exists (
          select 1 from public.payments p
          where p.round_id = r.id and p.status in ('paid', 'pending')
        )
      )
  );

update public.groups g
set platform_share_percent = private.platform_share_setting()
from service_switch s
where g.id = s.id;

-- Cagnotte de la période de service (non versée) : nouvelle cotisation d'une période ×
-- (durée du tour × parts), ce second facteur se retrouvant à partir de l'ancienne cagnotte.
update public.rounds r
set pot_amount = round(g.contribution_amount * g.platform_share_percent / 100.0)::integer
  * (r.pot_amount / round(g.contribution_amount * s.old_percent / 100.0)::integer)
from public.groups g
join service_switch s on s.id = g.id
where r.group_id = g.id
  and r.recipient_type = 'platform'
  and r.status <> 'paid_out'
  and round(g.contribution_amount * s.old_percent / 100.0) > 0;
