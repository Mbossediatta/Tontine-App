import { useEffect, useState } from 'react';
import { Pencil, Plus, UserMinus, UserPlus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  AsyncContent,
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  GroupPhoto as OrgLogo,
  Input,
  Modal,
  PhoneInput,
  Toggle,
} from '@/components/ui';
import { GroupPhotoPicker } from '@/features/admin/components/GroupPhotoPicker';
import { formatAmount, fullName, plural } from '@/lib/format';
import { useAction } from '@/lib/query';
import { organizationService } from '@/services';
import type { OrganizationSummary, PersonRole, OrgRole, SaveOrganizationInput } from '@/types';
import {
  orgKeys,
  organizationEntryLink,
  useCollectedByOrganization,
  useOrganizations,
} from './queries';

/**
 * Rubrique « Organisations » du super admin : créer l'espace d'une institution (AFP…),
 * nommer son administrateur général. Les structures et les cotisations sont gérées par
 * l'organisation ; le super admin peut consulter le fichier des militants (lecture seule).
 */
export default function OrganizationsPage() {
  const organizations = useOrganizations();
  const collected = useCollectedByOrganization();
  const [editing, setEditing] = useState<OrganizationSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [adminFor, setAdminFor] = useState<OrganizationSummary | null>(null);
  const [removing, setRemoving] = useState<{
    organization: OrganizationSummary;
    admin: PersonRole<OrgRole>;
  } | null>(null);

  const removeAdmin = useAction<{ organizationId: string; phone: string }>({
    action: ({ organizationId, phone }) =>
      organizationService.setRole(organizationId, phone, 'org_admin', false),
    success: 'Rôle retiré',
    onSuccess: () => setRemoving(null),
    refresh: [orgKeys.all],
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Organisations"
        plain
        subtitle="Espaces institutionnels (partis, associations…) : cotisations à part des tontines."
        actions={
          <OnlineButton
            variant="blue"
            size="sm"
            onClick={() => setCreating(true)}
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            Nouvelle organisation
          </OnlineButton>
        }
      />

      <AsyncContent query={organizations}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              title="Aucune organisation"
              description="Créez l’espace d’une organisation, puis nommez son administrateur général : il créera lui-même ses structures."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {list.map((organization) => (
                <li key={organization.id}>
                  <Card className="flex h-full flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <OrgLogo
                          name={organization.shortName}
                          src={organization.logoUrl ?? undefined}
                          size="lg"
                        />
                        <div className="min-w-0">
                          <h2 className="truncate font-display text-card-title text-blue-900">
                            {organization.shortName}
                          </h2>
                          <p className="text-label text-muted">{organization.name}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Modifier ${organization.shortName}`}
                        onClick={() => setEditing(organization)}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-blue-700 hover:bg-blue-50"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {organization.isSuspended ? <Badge tone="danger">Suspendue</Badge> : null}
                      <Badge tone="success">
                        {plural(organization.memberCount, 'membre actif', 'membres actifs')}
                      </Badge>
                      {organization.pendingCount > 0 ? (
                        <Badge tone="warning">
                          {plural(
                            organization.pendingCount,
                            'inscription en attente',
                            'inscriptions en attente',
                          )}
                        </Badge>
                      ) : null}
                      <Badge>
                        {plural(
                          organization.structureCount,
                          'structure active',
                          'structures actives',
                        )}
                      </Badge>
                      <Badge tone="info">
                        Encaissé {formatAmount(collected.data?.[organization.id] ?? 0)}
                      </Badge>
                    </div>

                    <p className="break-all text-small text-muted">
                      Lien d’entrée : {organizationEntryLink(organization.slug)}
                    </p>

                    <section className="border-t border-line pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-small font-bold text-ink">Administrateur général</h3>
                        <button
                          type="button"
                          onClick={() => setAdminFor(organization)}
                          className="inline-flex min-h-touch items-center gap-1 rounded-control px-2 text-label font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          <UserPlus className="h-4 w-4" aria-hidden="true" />
                          Nommer
                        </button>
                      </div>
                      {organization.admins.length === 0 ? (
                        <p className="mt-1 text-label text-amber-800">
                          Aucun pour le moment : nommez-en un pour que l’organisation puisse créer
                          ses structures.
                        </p>
                      ) : (
                        <ul className="mt-1 flex flex-col">
                          {organization.admins.map((admin) => (
                            <li
                              key={admin.userId}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="min-w-0 text-label">
                                <span className="font-semibold text-ink">{fullName(admin)}</span>{' '}
                                <span className="text-muted">+221 {admin.phone}</span>
                              </span>
                              <button
                                type="button"
                                aria-label={`Retirer ${fullName(admin)}`}
                                onClick={() => setRemoving({ organization, admin })}
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-danger hover:bg-danger-bg"
                              >
                                <UserMinus className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <Link
                      to={`/admin/organisations/${organization.id}/militants`}
                      className="inline-flex min-h-touch items-center gap-2 self-start rounded-control px-2 text-label font-semibold text-blue-700 hover:bg-blue-50"
                    >
                      <Users className="h-4 w-4" aria-hidden="true" />
                      Voir les militants
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </AsyncContent>

      <OrganizationDialog
        open={creating || editing !== null}
        organization={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
      <AdminDialog organization={adminFor} onClose={() => setAdminFor(null)} />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          removeAdmin.mutate({
            organizationId: removing.organization.id,
            phone: removing.admin.phone,
          })
        }
        loading={removeAdmin.isPending}
        tone="danger"
        title="Retirer l’administrateur général ?"
        confirmLabel="Retirer"
      >
        {removing
          ? `${fullName(removing.admin)} ne pourra plus gérer l’espace ${removing.organization.shortName}.`
          : null}
      </ConfirmDialog>
    </div>
  );
}

function OrganizationDialog({
  open,
  organization,
  onClose,
}: {
  open: boolean;
  organization: OrganizationSummary | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SaveOrganizationInput>({
    name: '',
    shortName: '',
    slug: '',
    color: '#1A5BA8',
  });

  useEffect(() => {
    if (!open) return;
    setForm(
      organization
        ? {
            id: organization.id,
            name: organization.name,
            shortName: organization.shortName,
            slug: organization.slug,
            color: organization.color,
            logoUrl: organization.logoUrl ?? undefined,
            isSuspended: organization.isSuspended,
          }
        : { name: '', shortName: '', slug: '', color: '#1A5BA8' },
    );
  }, [open, organization]);

  const save = useAction<SaveOrganizationInput, string>({
    action: (input) => organizationService.save(input),
    success: organization ? 'Organisation mise à jour' : 'Organisation créée',
    onSuccess: onClose,
    refresh: [orgKeys.all],
  });

  const set = (patch: Partial<SaveOrganizationInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={organization ? 'Modifier l’organisation' : 'Nouvelle organisation'}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(form);
        }}
      >
        <Input
          label="Nom complet"
          placeholder="Ex. Alliance des Forces de Progrès"
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          maxLength={80}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Sigle"
            placeholder="AFP"
            value={form.shortName}
            onChange={(event) => {
              const shortName = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
              set({
                shortName,
                // L'adresse suit le sigle tant qu'on ne l'a pas changée à la main.
                ...(organization || form.slug !== form.shortName.toLowerCase()
                  ? {}
                  : { slug: shortName.toLowerCase() }),
              });
            }}
            maxLength={10}
            hint="Début des notifications et des numéros de membre"
            required
          />
          <Input
            label="Adresse"
            placeholder="afp"
            value={form.slug}
            onChange={(event) =>
              set({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })
            }
            maxLength={30}
            hint={`Lien : ${organizationEntryLink(form.slug || '…')}`}
            required
          />
        </div>
        <label className="flex items-center gap-3 text-label font-bold text-ink">
          Couleur principale
          <input
            type="color"
            value={form.color}
            onChange={(event) => set({ color: event.target.value.toUpperCase() })}
            className="h-11 w-16 cursor-pointer rounded-control border border-line"
          />
          <span className="font-normal text-muted">{form.color}</span>
        </label>
        <GroupPhotoPicker
          name={form.shortName}
          value={form.logoUrl}
          onChange={(logoUrl) => set({ logoUrl })}
          label="Logo de l’organisation"
          help="Affiché sur la page de connexion, l’Espace membre et la carte de membre."
        />
        {organization ? (
          <Toggle
            label="Suspendre l’organisation"
            description="Plus aucun accès à son espace ni nouvelle inscription."
            checked={form.isSuspended ?? false}
            onChange={(isSuspended) => set({ isSuspended })}
          />
        ) : null}
        <OnlineButton
          type="submit"
          variant="blue"
          className="w-full"
          loading={save.isPending}
          disabled={!form.name.trim() || form.shortName.length < 2 || form.slug.length < 2}
        >
          {organization ? 'Enregistrer' : 'Créer l’organisation'}
        </OnlineButton>
      </form>
    </Modal>
  );
}

function AdminDialog({
  organization,
  onClose,
}: {
  organization: OrganizationSummary | null;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState('');
  useEffect(() => setPhone(''), [organization]);
  const grant = useAction<string>({
    action: (organizationId) =>
      organizationService.setRole(organizationId, phone, 'org_admin', true),
    success: 'Administrateur général nommé',
    onSuccess: onClose,
    refresh: [orgKeys.all],
  });
  return (
    <Modal
      open={organization !== null}
      onClose={onClose}
      title={`Administrateur général ${organization?.shortName ?? ''}`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (organization) grant.mutate(organization.id);
        }}
      >
        <PhoneInput
          label="Numéro de la personne"
          value={phone}
          onChange={setPhone}
          hint="Elle doit déjà avoir un compte (sinon : Membres → Ajouter). Elle sera prévenue par notification."
        />
        <OnlineButton
          type="submit"
          variant="blue"
          className="w-full"
          loading={grant.isPending}
          disabled={!/^7\d{8}$/.test(phone)}
        >
          Nommer
        </OnlineButton>
      </form>
    </Modal>
  );
}
