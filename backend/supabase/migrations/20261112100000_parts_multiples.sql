-- Parts du groupe en lots complets : le nombre total de parts doit être un multiple des
-- parts payées par tour. Sinon le dernier tour a moins de bénéficiaires et chacun y touche
-- une cagnotte plus grosse que les autres (ex. 5 parts, 2 par tour : 750, 750, 750, 750
-- puis 1 500), pour la même cotisation.
--
-- Vérifié par un déclencheur sur public.groups : à la création, à chaque changement des
-- parts, et au démarrage (brouillon → actif, y compris un nouveau cycle). Les groupes
-- déjà actifs ne sont pas touchés tant qu'on ne modifie pas leurs parts.

create or replace function private.check_even_shares()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  per_round integer := greatest(1, new.shares_per_round);
  lower_ok integer;
begin
  if tg_op = 'UPDATE'
    and (new.max_members, new.shares_per_round) is not distinct from
        (old.max_members, old.shares_per_round)
    and not (old.status = 'draft' and new.status = 'active') then
    return new;
  end if;
  if new.max_members >= per_round and new.max_members % per_round <> 0 then
    lower_ok := (new.max_members / per_round) * per_round;
    raise exception 'Avec % parts par tour, le nombre total de parts doit être un multiple de % (% ou %) : sinon le dernier tour aurait moins de bénéficiaires et chacun y recevrait plus que les autres pour la même cotisation.',
      per_round, per_round, lower_ok, lower_ok + per_round
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_even_shares on public.groups;
create trigger groups_even_shares
  before insert or update of max_members, shares_per_round, status on public.groups
  for each row execute function private.check_even_shares();
