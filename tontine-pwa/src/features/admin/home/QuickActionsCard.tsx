import { useState, type ReactNode } from 'react';
import { ChevronRight, FileSpreadsheet, Megaphone, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Button, Card, CardTitle, Modal, Textarea } from '@/components/ui';
import { downloadCsv } from '@/lib/csv';
import { errorMessage } from '@/lib/errors';
import { formatDate, fullName, paymentMethodLabel, plural } from '@/lib/format';
import { useAction } from '@/lib/query';
import { groupService, paymentService, roundService } from '@/services';
import type { GroupOverview, PaymentStatus } from '@/types';
import { InviteShare } from '../components/InviteShare';

const STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'Payé',
  pending: 'En attente',
  late: 'En retard',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

/**
 * Bilan du cycle en cours au format Excel : une ligne par membre et par tour ouvert
 * (statut, montant, pénalité, moyen et date de paiement).
 */
async function exportGroupReport(overview: GroupOverview): Promise<void> {
  const rounds = (await roundService.list(overview.group.id)).filter(
    (r) => r.round.status !== 'upcoming',
  );
  const lines = [
    [
      'Tour',
      'Bénéficiaire',
      'Membre',
      'Statut',
      'Montant (FCFA)',
      'Pénalité (FCFA)',
      'Moyen',
      'Payé le',
    ],
  ];
  for (const { round, beneficiary } of rounds) {
    for (const row of await paymentService.listForRound(round.id)) {
      lines.push([
        String(round.number),
        fullName(beneficiary),
        fullName(row.user),
        STATUS_LABELS[row.status],
        String(row.payment?.amount ?? overview.group.contributionAmount + row.penalty),
        String(row.penalty),
        row.payment ? paymentMethodLabel(row.payment.method) : '',
        row.payment?.paidAt ? formatDate(row.payment.paidAt) : '',
      ]);
    }
  }
  const slug = overview.group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  downloadCsv(lines, `bilan-${slug}-${new Date().toISOString().slice(0, 10)}.csv`);
}

/** Bouton pleine largeur de la liste « Actions rapides » : icône, libellé, chevron. */
function ActionButton({
  icon,
  children,
  onClick,
  loading,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <OnlineButton
      variant="outline"
      onClick={onClick}
      loading={loading}
      icon={icon}
      className="w-full justify-start text-left"
    >
      <span className="flex-1">{children}</span>
      <ChevronRight className="h-5 w-5 text-muted" aria-hidden="true" />
    </OnlineButton>
  );
}

/** Fenêtre « Envoyer une annonce » : le message part en notification à tous les membres. */
function AnnounceDialog({
  overview,
  open,
  onClose,
}: {
  overview: GroupOverview;
  open: boolean;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const send = useAction({
    action: () => groupService.announce(overview.group.id, message),
    success: (count: number) => `Annonce envoyée à ${plural(count, 'membre')}`,
    onSuccess: () => {
      setMessage('');
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Annonce · ${overview.group.name}`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <OnlineButton
            variant="blue"
            loading={send.isPending}
            disabled={message.trim().length === 0}
            onClick={() => send.mutate()}
          >
            Envoyer
          </OnlineButton>
        </div>
      }
    >
      <Textarea
        label="Message"
        hint="Chaque membre le recevra en notification."
        rows={4}
        maxLength={500}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
    </Modal>
  );
}

/**
 * « Actions rapides » sur le groupe sélectionné : annonce, invitation (tant que le
 * groupe n'a pas démarré) et export du bilan pour Excel.
 */
export function QuickActionsCard({ overview }: { overview: GroupOverview }) {
  const [announcing, setAnnouncing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { group } = overview;

  const onExport = async () => {
    setExporting(true);
    try {
      await exportGroupReport(overview);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Actions rapides</CardTitle>
      <ActionButton
        icon={<Megaphone className="h-5 w-5" aria-hidden="true" />}
        onClick={() => setAnnouncing(true)}
      >
        Envoyer une annonce au groupe
      </ActionButton>
      {/* On ne peut rejoindre un groupe qu'avant son démarrage. */}
      {group.status === 'draft' ? (
        <ActionButton
          icon={<UserPlus className="h-5 w-5" aria-hidden="true" />}
          onClick={() => setInviting(true)}
        >
          Inviter par lien ou numéro
        </ActionButton>
      ) : null}
      {group.status !== 'draft' ? (
        <ActionButton
          icon={<FileSpreadsheet className="h-5 w-5" aria-hidden="true" />}
          onClick={() => void onExport()}
          loading={exporting}
        >
          Exporter le bilan (Excel)
        </ActionButton>
      ) : null}

      <AnnounceDialog overview={overview} open={announcing} onClose={() => setAnnouncing(false)} />
      <Modal open={inviting} onClose={() => setInviting(false)} title="Inviter des membres">
        <div className="flex flex-col gap-3">
          <InviteShare code={group.inviteCode} groupName={group.name} />
          <Link
            to={`/admin/groupes/${group.id}?onglet=membres`}
            className="font-bold text-blue-700 underline"
          >
            Ajouter directement par numéro de téléphone
          </Link>
        </div>
      </Modal>
    </Card>
  );
}
