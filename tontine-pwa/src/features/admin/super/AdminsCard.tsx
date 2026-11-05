import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Badge, Card, CardTitle, ConfirmDialog } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatPhone, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { adminService } from '@/services';
import type { AdminPerformance } from '@/types';
import { headerLinkClass, rowActionClass } from '../components/linkStyles';
import { RecoveryBar } from '../components/RecoveryBar';

/** Colonnes du tableau sur écran large : admin · groupes · membres · recouvrement · statut · actions. */
const COLUMNS =
  'md:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,2fr)_minmax(0,1fr)_200px]';

/**
 * Tableau des administrateurs : groupes, membres, taux de recouvrement et statut.
 * Écran large : colonnes. Mobile : une carte par admin. « Voir » ouvre sa fiche,
 * « Suspendre » / « Réactiver » agit directement (après confirmation).
 */
export function AdminTable({ admins }: { admins: AdminPerformance[] }) {
  // Admin à suspendre ou réactiver, en attente de confirmation.
  const [pending, setPending] = useState<AdminPerformance | null>(null);
  const toggle = useAction({
    action: (admin: AdminPerformance) =>
      admin.user.isSuspended
        ? adminService.reactivate(admin.user.id)
        : adminService.suspend(admin.user.id),
    success: () => (pending?.user.isSuspended ? 'Compte réactivé' : 'Compte suspendu'),
    onSuccess: () => setPending(null),
  });

  return (
    <div>
      {/* En-têtes de colonnes : visibles seulement quand les colonnes existent. */}
      <div
        className={`hidden gap-3 border-b border-line px-2 pb-2 text-small uppercase tracking-wide text-muted md:grid ${
          COLUMNS
        }`}
        aria-hidden="true"
      >
        <span>Admin</span>
        <span>Groupes</span>
        <span>Membres</span>
        <span>Recouvrement</span>
        <span>Statut</span>
        <span>Actions</span>
      </div>
      <ul className="divide-y divide-line">
        {admins.map((admin) => (
          // Mobile : nom + statut, puis chiffres, barre et actions.
          // Écran large : ordre des colonnes (md:order-*).
          <li
            key={admin.user.id}
            className={`grid grid-cols-2 items-center gap-x-3 gap-y-2 px-2 py-3 ${COLUMNS}`}
          >
            <span className="min-w-0 md:order-1">
              <span className="block truncate font-bold text-ink">{fullName(admin.user)}</span>
              <span className="block text-small tabular-nums text-muted">
                {formatPhone(admin.user.phone)}
              </span>
            </span>
            <span className="flex flex-wrap justify-end gap-1 md:order-5 md:justify-start">
              <Badge tone={admin.user.isSuspended ? 'warning' : 'success'}>
                {admin.user.isSuspended ? 'Suspendu' : 'Actif'}
              </Badge>
              {admin.pinPending ? (
                <Badge tone="info" icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}>
                  PIN à créer
                </Badge>
              ) : null}
            </span>
            <span className="tabular-nums text-ink md:order-2">
              <span className="text-muted md:hidden">Groupes : </span>
              {admin.groups.length}
            </span>
            <span className="tabular-nums text-ink md:order-3">
              <span className="text-muted md:hidden">Membres : </span>
              {admin.memberCount}
            </span>
            <span className="col-span-2 md:order-4 md:col-span-1">
              <RecoveryBar rate={admin.recoveryRate} />
            </span>
            <span className="col-span-2 flex gap-2 md:order-6 md:col-span-1">
              <Link
                to={`/admin/administrateurs/${admin.user.id}`}
                className={cn(headerLinkClass.outline, rowActionClass, 'justify-center')}
              >
                Voir
              </Link>
              <OnlineButton
                variant="outline"
                size="sm"
                className={rowActionClass}
                onClick={() => setPending(admin)}
              >
                {admin.user.isSuspended ? 'Réactiver' : 'Suspendre'}
              </OnlineButton>
            </span>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => pending && toggle.mutate(pending)}
        loading={toggle.isPending}
        tone={pending?.user.isSuspended ? 'blue' : 'danger'}
        title={pending?.user.isSuspended ? 'Réactiver ce compte ?' : 'Suspendre ce compte ?'}
        confirmLabel={pending?.user.isSuspended ? 'Réactiver' : 'Suspendre'}
      >
        {pending ? (
          <p>
            {fullName(pending.user)}
            {pending.user.isSuspended
              ? ' pourra de nouveau se connecter et gérer ses groupes.'
              : ' ne pourra plus se connecter tant que le compte est suspendu.'}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

/** Carte « Administrateurs » du tableau de bord, avec le lien vers la rubrique complète. */
export function AdminsCard({ admins }: { admins: AdminPerformance[] }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Administrateurs</CardTitle>
        <Link to="/admin/administrateurs" className="font-bold text-blue-700 underline">
          Gérer les admins
        </Link>
      </div>
      {admins.length === 0 ? (
        <p className="text-muted">Aucun administrateur pour le moment.</p>
      ) : (
        <AdminTable admins={admins} />
      )}
    </Card>
  );
}
