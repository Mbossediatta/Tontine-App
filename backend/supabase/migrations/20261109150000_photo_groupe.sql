-- Photo (ou logo) d'un groupe, facultative.
--
-- Choisie à la création du groupe ou plus tard dans ses réglages, par ceux qui le gèrent.
-- Elle se voit partout où le groupe apparaît : membres du groupe, groupes ouverts d'une
-- communauté, écran « Rejoindre » (code d'invitation), listes des administrateurs.
--
-- Comme la photo de profil, l'image est compressée par l'application (carré JPEG de
-- 256 px, quelques dizaines de Ko) et gardée dans la ligne du groupe sous forme de
-- « data URL ». Le serveur n'accepte qu'une image, et d'un poids raisonnable.

alter table public.groups
  add column photo_url text,
  add constraint groups_photo_url_check check (
    photo_url is null
    or (photo_url ~ '^data:image/(jpeg|png|webp);base64,' and octet_length(photo_url) <= 400000)
  );

-- Pose ou retire (p_photo vide ou null) la photo du groupe.
create or replace function public.group_set_photo(p_group uuid, p_photo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_manage(g);
  photo text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if photo is not null and (
    photo !~ '^data:image/(jpeg|png|webp);base64,' or octet_length(photo) > 400000
  ) then
    raise exception 'Photo invalide ou trop lourde.' using errcode = '22023';
  end if;
  if photo is distinct from g.photo_url then
    update public.groups set photo_url = photo where id = g.id;
    perform private.audit(uid, 'group_updated',
      format(case when photo is null then 'a retiré la photo de « %s »'
                  else 'a changé la photo de « %s »' end, g.name),
      g.id);
  end if;
end;
$$;

revoke all on function public.group_set_photo(uuid, text) from public, anon;
grant execute on function public.group_set_photo(uuid, text) to authenticated;
