import { useState, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  ChevronRight,
  KeyRound,
  Pencil,
  ShieldOff,
  UserCheck,
  UserX,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GroupStatusBadge } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  AsyncContent,
  Badge,
  Card,
  CardTitle,
  ConfirmDialog,
  Modal,
  Select,
} from '@/components/ui';
import { formatPhone, fullName, plural } from '@/lib/format';
import { useAction } from '@/lib/query';
import { adminService, memberService } from '@/services';
import type { AdminPerformance } from '@/types';
import { AccountFormDialog } from './components/AccountFormDialog';
import { RecoveryBar } from './components/RecoveryBar';
import { StatCard } from './components/StatCard';
import { useAdmin, useAdmins } from './queries';

/** Actions confirmées par une simple fenêtre « Êtes-vous sûr ? ». */
type ConfirmKind = 'suspend' | 'reactivate' | 'resetPin' | 'delete';

const CONFIRMS: Record<
  ConfirmKind,
  {
    title: string;
    confirm: string;
    tone: 'blue' | 'danger';
    success: string;
    body: (name: string) => string;
    run: (userId: string) => Promise<void>;
  }
> = {
  suspend: {
    title: 'Suspendre cet administrateur ?',
    confirm: 'Suspendre',
    tone: 'danger',
    success: 'Compte suspendu',
    body: (name) =>
      `${name} ne pourra plus se connecter. Pensez à réattribuer ses groupes pour qu’ils restent suivis.`,
    run: (id) => adminService.suspend(id),
  },
  reactivate: {
    title: 'Réactiver cet administrateur ?',
    confirm: 'Réactiver',
    tone: 'blue',
    success: 'Compte réactivé',
    body: (name) => `${name} pourra de nouveau se connecter et gérer ses groupes.`,
    run: (id) => adminService.reactivate(id),
  },
  resetPin: {
    title: 'Réinitialiser son PIN ?',
    confirm: 'Réinitialiser',
    tone: 'blue',
    success: 'PIN réinitialisé',
    body: (name) =>
      `À sa prochaine connexion, ${name} recevra un code par SMS et devra créer un nouveau PIN.`,
    run: (id) => memberService.resetPin(id),
  },
  delete: {
    title: 'Supprimer cet administrateur ?',
    confirm: 'Supprimer',
    tone: 'danger',
    success: 'Rôle administrateur retiré',
    body: (name) =>
      `${name} perd ses droits d’administrateur et redevient simple participant. Son compte et son historique sont conservés.`,
    run: (id) => adminService.deleteAdmin(id),
  },
};

/** Bouton pleine largeur de la carte « Actions » : icône, libellé, et couleur selon le risque. */
function ActionButton({
  icon,
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <OnlineButton
      variant={danger ? 'danger' : 'outline'}
      onClick={onClick}
      icon={icon}
      disabled={disabled}
      className="w-full justify-start"
    >
      {children}
    </OnlineButton>
  );
}

/** Fenêtre « Réattribuer ses groupes » : choix de l'administrateur qui les reprend. */
function ReassignDialog({
  admin,
  open,
  onClose,
}: {
  admin: AdminPerformance;
  open: boolean;
  onClose: () => void;
}) {
  const admins = useAdmins();
  const [targetId, setTargetId] = useState('');
  // Candidats : les autres administrateurs actifs.
  const candidates = (admins.data ?? []).filter(
    (a) => a.user.id !== admin.user.id && !a.user.isSuspended,
  );
  const reassign = useAction({
    action: () => adminService.reassignGroups(admin.user.id, targetId),
    success: (count: number) => `${plural(count, 'groupe réattribué', 'groupes réattribués')}`,
    onSuccess: onClose,
  });

  return (
    <Modal open={open} onClose={onClose} title="Réattribuer ses groupes">
      <div className="flex flex-col gap-4">
        <p className="text-ink">
          Les {plural(admin.groups.length, 'groupe')} de {fullName(admin.user)} passent sous la
          responsabilité d’un autre administrateur. S’il y cotisait, il reste membre.
        </p>
        {candidates.length === 0 ? (
          <p className="rounded-control bg-warning-bg p-3 text-warning">
            Aucun autre administrateur actif : créez-en un d’abord.
          </p>
        ) : (
          <Select
            label="Nouvel administrateur"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="Choisir…"
            options={candidates.map((a) => ({
              value: a.user.id,
              label: `${fullName(a.user)} · ${plural(a.groups.length, 'groupe')}`,
            }))}
          />
        )}
        <OnlineButton
          variant="blue"
          loading={reassign.isPending}
          disabled={!targetId}
          onClick={() => reassign.mutate()}
          className="w-full"
        >
          Réattribuer
        </OnlineButton>
      </div>
    </Modal>
  );
}

/**
 * Fiche d'un administrateur : chiffres clés, groupes gérés, et toutes les actions
 * du super administrateur (modifier, suspendre, PIN, réattribuer, supprimer).
 */
export default function AdminDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useAdmin(id);
  const [editing, setEditing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);

  const run = useAction({
    action: (kind: ConfirmKind) => CONFIRMS[kind].run(id),
    success: () => (confirm ? CONFIRMS[confirm].success : 'Fait'),
    onSuccess: () => {
      // Après suppression, la fiche n'a plus lieu d'être : retour à la liste.
      if (confirm === 'delete') navigate('/admin/administrateurs', { replace: true });
      setConfirm(null);
    },
  });

  return (
    <AsyncContent query={query} errorMessage="Cet administrateur est introuvable.">
      {(admin) => {
        const { user } = admin;
        const name = fullName(user);
        const hasGroups = admin.groups.length > 0;
        return (
          <div className="flex flex-col gap-6">
            <PageHeader
              title={name}
              plain
              backTo="/admin/administrateurs"
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{formatPhone(user.phone)}</span>
                  <Badge tone={user.isSuspended ? 'warning' : 'success'}>
                    {user.isSuspended ? 'Suspendu' : 'Actif'}
                  </Badge>
                  {admin.pinPending ? (
                    <Badge
                      tone="info"
                      icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
                    >
                      PIN à créer à la prochaine connexion
                    </Badge>
                  ) : null}
                </span>
              }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
              <div className="flex flex-col gap-6">
                <section
                  className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3"
                  aria-label="Chiffres clés"
                >
                  <StatCard label="Groupes gérés" value={admin.groups.length} />
                  <StatCard label="Membres suivis" value={admin.memberCount} />
                  {/* Sur téléphone, le recouvrement (avec sa barre) prend toute la largeur. */}
                  <div className="min-[360px]:col-span-2 sm:col-span-1">
                    <StatCard
                      label="Recouvrement"
                      value={admin.recoveryRate === null ? '—' : `${admin.recoveryRate} %`}
                      hint={<RecoveryBar rate={admin.recoveryRate} />}
                    />
                  </div>
                </section>

                <Card padded={false} className="overflow-hidden">
                  <CardTitle className="px-4 pt-4">Groupes gérés</CardTitle>
                  {hasGroups ? (
                    <ul className="mt-2 divide-y divide-line">
                      {admin.groups.map((group) => (
                        <li key={group.id}>
                          <Link
                            to={`/admin/groupes/${group.id}`}
                            className="flex min-h-touch items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-blue-50"
                          >
                            <span className="min-w-0 flex-1 truncate font-bold text-ink">
                              {group.name}
                            </span>
                            <GroupStatusBadge status={group.status} />
                            <ChevronRight className="h-5 w-5 text-muted" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 pb-4 pt-2 text-muted">
                      Ne gère aucun groupe pour le moment.
                    </p>
                  )}
                </Card>
              </div>

              <Card className="flex flex-col gap-2">
                <CardTitle>Actions</CardTitle>
                <ActionButton
                  icon={<Pencil className="h-5 w-5" aria-hidden="true" />}
                  onClick={() => setEditing(true)}
                >
                  Modifier nom et numéro
                </ActionButton>
                <ActionButton
                  icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
                  onClick={() => setConfirm('resetPin')}
                >
                  Réinitialiser le PIN
                </ActionButton>
                <ActionButton
                  icon={<ArrowRightLeft className="h-5 w-5" aria-hidden="true" />}
                  onClick={() => setReassigning(true)}
                  disabled={!hasGroups}
                >
                  Réattribuer ses groupes
                </ActionButton>
                {user.isSuspended ? (
                  <ActionButton
                    icon={<UserCheck className="h-5 w-5" aria-hidden="true" />}
                    onClick={() => setConfirm('reactivate')}
                  >
                    Réactiver le compte
                  </ActionButton>
                ) : (
                  <ActionButton
                    icon={<UserX className="h-5 w-5" aria-hidden="true" />}
                    onClick={() => setConfirm('suspend')}
                    danger
                  >
                    Suspendre le compte
                  </ActionButton>
                )}
                <ActionButton
                  icon={<ShieldOff className="h-5 w-5" aria-hidden="true" />}
                  onClick={() => setConfirm('delete')}
                  disabled={hasGroups}
                  danger
                >
                  Supprimer l’administrateur
                </ActionButton>
                {hasGroups ? (
                  <p className="text-small text-muted">
                    Pour le supprimer, réattribuez d’abord ses groupes.
                  </p>
                ) : null}
              </Card>
            </div>

            <AccountFormDialog
              kind="admin"
              open={editing}
              onClose={() => setEditing(false)}
              account={user}
            />
            <ReassignDialog
              admin={admin}
              open={reassigning}
              onClose={() => setReassigning(false)}
            />
            <ConfirmDialog
              open={confirm !== null}
              onClose={() => setConfirm(null)}
              onConfirm={() => confirm && run.mutate(confirm)}
              loading={run.isPending}
              tone={confirm ? CONFIRMS[confirm].tone : 'blue'}
              title={confirm ? CONFIRMS[confirm].title : ''}
              confirmLabel={confirm ? CONFIRMS[confirm].confirm : ''}
            >
              {confirm ? <p>{CONFIRMS[confirm].body(name)}</p> : null}
            </ConfirmDialog>
          </div>
        );
      }}
    </AsyncContent>
  );
}
