import { useEffect, useMemo, useState } from 'react';
import { Building2, Pencil, Plus, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { AsyncContent, Badge, Card, EmptyState, Input, Modal, Textarea } from '@/components/ui';
import { fullName, plural } from '@/lib/format';
import { useAction } from '@/lib/query';
import { adminService } from '@/services';
import type { Community, GroupOverview, SaveCommunityInput } from '@/types';
import { useAdmins, useAllGroups, useCommunities } from './queries';

export default function CommunitiesPage() {
  const communities = useCommunities();
  const admins = useAdmins();
  const groups = useAllGroups();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Community | null>(null);

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const adminsById = useMemo(
    () => new Map((admins.data ?? []).map((admin) => [admin.user.id, admin.user])),
    [admins.data],
  );
  const groupData = groups.data;
  const groupsByCommunity = useMemo(() => {
    const result = new Map<string, GroupOverview[]>();
    for (const overview of groupData ?? []) {
      const communityId = overview.group.communityId;
      if (!communityId) continue;
      result.set(communityId, [...(result.get(communityId) ?? []), overview]);
    }
    return result;
  }, [groupData]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Communautés"
        plain
        subtitle="Affectez des administrateurs et regroupez les tontines par espace."
        actions={
          <OnlineButton
            variant="blue"
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            Nouvelle communauté
          </OnlineButton>
        }
      />

      <AsyncContent query={communities}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              title="Aucune communauté"
              description="Créez une communauté, puis affectez-lui un ou plusieurs administrateurs."
              action={
                <OnlineButton
                  variant="blue"
                  onClick={() => setDialogOpen(true)}
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                >
                  Créer une communauté
                </OnlineButton>
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {list.map((community) => {
                const communityGroups = groupsByCommunity.get(community.id) ?? [];
                const activeCount = communityGroups.filter(
                  ({ group }) => group.status === 'active',
                ).length;
                return (
                  <li key={community.id}>
                    <Card className="flex h-full flex-col gap-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-blue-50 text-blue-700">
                            <Building2 className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <h2 className="truncate font-display text-card-title text-blue-900">
                              {community.name}
                            </h2>
                            {community.description ? (
                              <p className="mt-1 text-label text-muted">{community.description}</p>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Modifier ${community.name}`}
                          onClick={() => {
                            setEditing(community);
                            setDialogOpen(true);
                          }}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-blue-700 hover:bg-blue-50"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge icon={<UsersRound className="h-3.5 w-3.5" aria-hidden="true" />}>
                          {plural(community.adminIds.length, 'administrateur')}
                        </Badge>
                        <Badge>{plural(communityGroups.length, 'groupe')}</Badge>
                        <Badge tone="success">{plural(activeCount, 'groupe actif')}</Badge>
                      </div>

                      <section className="border-t border-line pt-3">
                        <h3 className="text-small font-bold text-ink">Administrateurs affectés</h3>
                        <p className="mt-1 text-label text-muted">
                          {community.adminIds
                            .map((id) => {
                              const admin = adminsById.get(id);
                              return admin ? fullName(admin) : null;
                            })
                            .filter(Boolean)
                            .join(' · ') || 'Chargement des administrateurs…'}
                        </p>
                      </section>

                      <section className="border-t border-line pt-3">
                        <h3 className="text-small font-bold text-ink">Groupes de la communauté</h3>
                        {communityGroups.length > 0 ? (
                          <ul className="mt-2 flex flex-col gap-1">
                            {communityGroups.slice(0, 4).map(({ group, adminName }) => (
                              <li key={group.id}>
                                {/* Chaque groupe a son propre admin, distinct ou non de ceux de la communauté. */}
                                <Link
                                  to={`/admin/groupes/${group.id}`}
                                  className="flex min-h-touch items-center justify-between gap-2 rounded-control px-2 py-2 text-label hover:bg-blue-50"
                                >
                                  <span className="truncate font-semibold text-blue-700">
                                    {group.name}
                                  </span>
                                  <span className="shrink-0 text-small text-muted">
                                    Admin : {adminName}
                                  </span>
                                </Link>
                              </li>
                            ))}
                            {communityGroups.length > 4 ? (
                              <li className="px-2 pt-1 text-small text-muted">
                                +{communityGroups.length - 4} autres groupes
                              </li>
                            ) : null}
                          </ul>
                        ) : (
                          <p className="mt-1 text-label text-muted">
                            Aucun groupe pour le moment. Les nouveaux groupes pourront être créés
                            dans cet espace.
                          </p>
                        )}
                      </section>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )
        }
      </AsyncContent>

      <CommunityDialog open={dialogOpen} community={editing} onClose={closeDialog} />
    </div>
  );
}

function CommunityDialog({
  open,
  community,
  onClose,
}: {
  open: boolean;
  community: Community | null;
  onClose: () => void;
}) {
  const admins = useAdmins();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [adminIds, setAdminIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(community?.name ?? '');
    setDescription(community?.description ?? '');
    setAdminIds(community?.adminIds ?? []);
  }, [open, community]);

  const save = useAction<SaveCommunityInput, Community>({
    action: (input) => adminService.saveCommunity(input),
    success: community ? 'Communauté mise à jour' : 'Communauté créée',
    onSuccess: onClose,
  });

  const toggleAdmin = (adminId: string) => {
    setAdminIds((selected) =>
      selected.includes(adminId) ? selected.filter((id) => id !== adminId) : [...selected, adminId],
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={community ? 'Modifier la communauté' : 'Nouvelle communauté'}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            id: community?.id,
            name,
            description,
            adminIds,
          });
        }}
      >
        <Input
          label="Nom de la communauté"
          placeholder="Ex. Ouakam"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={2}
          maxLength={60}
        />
        <Textarea
          label="Description (facultatif)"
          placeholder="Ex. Les groupes du quartier de Ouakam"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={300}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label font-bold text-ink">
            Administrateurs de cet espace
          </legend>
          {(admins.data ?? [])
            .filter(({ user }) => !user.isSuspended)
            .map(({ user }) => {
              const checked = adminIds.includes(user.id);
              return (
                <label
                  key={user.id}
                  className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-line px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAdmin(user.id)}
                    className="h-5 w-5 accent-blue-700"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{fullName(user)}</span>
                    <span className="block text-small text-muted">+221 {user.phone}</span>
                  </span>
                </label>
              );
            })}
          {admins.data?.length === 0 ? (
            <p className="text-label text-muted">
              Créez d’abord un compte administrateur pour l’affecter à cette communauté.
            </p>
          ) : null}
        </fieldset>
        {adminIds.length === 0 ? (
          <p role="status" className="text-small text-amber-800">
            Sélectionnez au moins un administrateur.
          </p>
        ) : null}

        <OnlineButton
          type="submit"
          variant="blue"
          className="w-full"
          loading={save.isPending}
          disabled={!name.trim() || adminIds.length === 0}
        >
          {community ? 'Enregistrer' : 'Créer la communauté'}
        </OnlineButton>
      </form>
    </Modal>
  );
}
