import { useEffect, useMemo, useState } from 'react';
import { Archive, Ban, CirclePlay, Flag, UserCog } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Badge, Card, ConfirmDialog, Modal, Select } from '@/components/ui';
import { formatDate, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { adminService } from '@/services';
import type { GroupOverview } from '@/types';
import { rowActionClass } from '../components/linkStyles';
import { useAdmins, useCommunities } from '../queries';

/** Actions de supervision qui demandent une confirmation. */
type Kind = 'suspend' | 'reactivate' | 'close' | 'archive';

const ACTIONS: Record<
  Kind,
  {
    title: string;
    confirm: string;
    tone: 'blue' | 'danger';
    success: string;
    body: string;
    run: (groupId: string) => Promise<void>;
  }
> = {
  suspend: {
    title: 'Suspendre ce groupe ?',
    confirm: 'Suspendre',
    tone: 'danger',
    success: 'Groupe suspendu',
    body: 'Paiements et versements sont gelés jusqu’à la réactivation. L’administrateur du groupe est prévenu.',
    run: (id) => adminService.suspendGroup(id),
  },
  reactivate: {
    title: 'Réactiver ce groupe ?',
    confirm: 'Réactiver',
    tone: 'blue',
    success: 'Groupe réactivé',
    body: 'Le groupe reprend là où il s’était arrêté : paiements et versements sont de nouveau possibles.',
    run: (id) => adminService.reactivateGroup(id),
  },
  close: {
    title: 'Clôturer définitivement ce groupe ?',
    confirm: 'Clôturer',
    tone: 'danger',
    success: 'Groupe clôturé',
    body: 'Le cycle s’arrête : plus aucun paiement ni versement ne sera possible. Cette action est définitive.',
    run: (id) => adminService.closeGroup(id),
  },
  archive: {
    title: 'Archiver ce groupe ?',
    confirm: 'Archiver',
    tone: 'blue',
    success: 'Groupe archivé',
    body: 'Le groupe disparaît des listes courantes. Son historique reste consultable dans le filtre « Archivés ».',
    run: (id) => adminService.archiveGroup(id),
  },
};

/** Fenêtre « Changer d'administrateur » : choix parmi les administrateurs actifs. */
function TransferGroupDialog({
  overview,
  open,
  onClose,
}: {
  overview: GroupOverview;
  open: boolean;
  onClose: () => void;
}) {
  const admins = useAdmins();
  const communities = useCommunities();
  const [communityId, setCommunityId] = useState(overview.group.communityId ?? '');
  const [adminId, setAdminId] = useState(overview.group.adminId);
  useEffect(() => {
    if (open) {
      setCommunityId(overview.group.communityId ?? '');
      setAdminId(overview.group.adminId);
    }
  }, [open, overview.group.communityId, overview.group.adminId]);
  // Tout admin actif peut gérer le groupe, qu'il soit admin de la communauté ou non.
  const candidates = useMemo(
    () => (admins.data ?? []).filter((a) => !a.user.isSuspended),
    [admins.data],
  );
  const communityAdminIds =
    (communities.data ?? []).find((community) => community.id === communityId)?.adminIds ?? [];
  const change = useAction({
    action: () => adminService.transferGroup(overview.group.id, communityId, adminId),
    success: 'Groupe transféré',
    onSuccess: onClose,
  });

  return (
    <Modal open={open} onClose={onClose} title="Transférer le groupe">
      <div className="flex flex-col gap-4">
        <p className="text-ink">
          Actuellement dans <strong>{overview.communityName ?? 'une communauté'}</strong>, géré par{' '}
          <strong>{overview.adminName}</strong>. Les membres du groupe restent inscrits.
        </p>
        <Select
          label="Nouvelle communauté"
          value={communityId}
          onChange={(e) => setCommunityId(e.target.value)}
          placeholder="Choisir une communauté…"
          options={(communities.data ?? []).map((community) => ({
            value: community.id,
            label: community.name,
          }))}
        />
        <Select
          label="Administrateur du groupe"
          value={adminId}
          onChange={(e) => setAdminId(e.target.value)}
          placeholder="Choisir un administrateur…"
          hint="Il n’a pas besoin d’être admin de la communauté."
          options={candidates.map((a) => ({
            value: a.user.id,
            label: [
              fullName(a.user),
              communityAdminIds.includes(a.user.id) ? 'admin de la communauté' : null,
              a.user.id === overview.group.adminId ? 'actuel' : null,
            ]
              .filter(Boolean)
              .join(' · '),
          }))}
        />
        <OnlineButton
          variant="blue"
          loading={change.isPending}
          disabled={!communityId || !adminId || !candidates.some((a) => a.user.id === adminId)}
          onClick={() => change.mutate()}
          className="w-full"
        >
          Confirmer
        </OnlineButton>
      </div>
    </Modal>
  );
}

/**
 * Bandeau de supervision (super administrateur uniquement) en haut de la fiche d'un
 * groupe : admin responsable, et actions suspendre / réactiver / clôturer / archiver.
 */
export function SupervisionCard({ overview }: { overview: GroupOverview }) {
  const { group } = overview;
  const [kind, setKind] = useState<Kind | null>(null);
  const [transferring, setTransferring] = useState(false);
  const run = useAction({
    action: (k: Kind) => ACTIONS[k].run(group.id),
    success: () => (kind ? ACTIONS[kind].success : 'Fait'),
    onSuccess: () => setKind(null),
  });

  const finished = group.status === 'finished';

  return (
    <Card tone="info" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-label text-blue-900">
          Supervision · communauté : <strong>{overview.communityName ?? 'Non affectée'}</strong> ·
          administrateur : <strong>{overview.adminName}</strong>
        </p>
        {group.archivedAt ? (
          <Badge icon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />}>
            Archivé le {formatDate(group.archivedAt)}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {!finished ? (
          <OnlineButton
            variant="outline"
            size="sm"
            className={rowActionClass}
            onClick={() => setTransferring(true)}
            icon={<UserCog className="h-4 w-4" aria-hidden="true" />}
          >
            Transférer
          </OnlineButton>
        ) : null}
        {group.status === 'suspended' ? (
          <OnlineButton
            variant="outline"
            size="sm"
            className={rowActionClass}
            onClick={() => setKind('reactivate')}
            icon={<CirclePlay className="h-4 w-4" aria-hidden="true" />}
          >
            Réactiver
          </OnlineButton>
        ) : !finished ? (
          <OnlineButton
            variant="outline"
            size="sm"
            className={rowActionClass}
            onClick={() => setKind('suspend')}
            icon={<Ban className="h-4 w-4" aria-hidden="true" />}
          >
            Suspendre
          </OnlineButton>
        ) : null}
        {!finished ? (
          <OnlineButton
            variant="danger"
            size="sm"
            className={rowActionClass}
            onClick={() => setKind('close')}
            icon={<Flag className="h-4 w-4" aria-hidden="true" />}
          >
            Clôturer
          </OnlineButton>
        ) : null}
        {finished && !group.archivedAt ? (
          <OnlineButton
            variant="outline"
            size="sm"
            className={rowActionClass}
            onClick={() => setKind('archive')}
            icon={<Archive className="h-4 w-4" aria-hidden="true" />}
          >
            Archiver
          </OnlineButton>
        ) : null}
      </div>

      <TransferGroupDialog
        overview={overview}
        open={transferring}
        onClose={() => setTransferring(false)}
      />
      <ConfirmDialog
        open={kind !== null}
        onClose={() => setKind(null)}
        onConfirm={() => kind && run.mutate(kind)}
        loading={run.isPending}
        tone={kind ? ACTIONS[kind].tone : 'blue'}
        title={kind ? ACTIONS[kind].title : ''}
        confirmLabel={kind ? ACTIONS[kind].confirm : ''}
        // Clôture définitive : il faut recopier le nom du groupe pour confirmer.
        confirmText={kind === 'close' ? group.name : undefined}
      >
        {kind ? <p>{ACTIONS[kind].body}</p> : null}
      </ConfirmDialog>
    </Card>
  );
}
