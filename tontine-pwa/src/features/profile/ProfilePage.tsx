import { useState } from 'react';
import { LogOut, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar, Button, Card, ConfirmDialog } from '@/components/ui';
import { useLogout } from '@/features/auth/useLogout';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { formatPhone, fullName } from '@/lib/format';
import { DeleteAccountCard } from './DeleteAccountCard';
import { EditProfileDialog } from './EditProfileDialog';
import { InstallCard } from './InstallCard';
import { NotificationPrefsCard } from './NotificationPrefsCard';
import { PayoutCard } from './PayoutCard';

const ROLE_LABELS = {
  super_admin: 'Super administrateur',
  admin: 'Administrateur',
  user: 'Participant',
} as const;

export default function ProfilePage() {
  const user = useCurrentUser();
  const logout = useLogout();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [editing, setEditing] = useState(false);
  // Le super administrateur ne participe à aucune tontine : ni numéro de reversement,
  // ni préférences de rappels. Il ne peut pas non plus supprimer son compte, sans quoi
  // la plateforme n'aurait plus personne pour l'administrer.
  const isParticipant = user.globalRole !== 'super_admin';
  const isAdmin = user.globalRole !== 'user';

  return (
    <div className={cn('flex flex-col gap-3', isAdmin && 'max-w-2xl')}>
      <PageHeader
        title={user.globalRole === 'super_admin' ? 'Mon compte' : 'Profil'}
        plain={isAdmin}
      />
      <Card className="flex flex-wrap items-center gap-4">
        <Avatar name={fullName(user)} src={user.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-card-title text-ink">{fullName(user)}</p>
          <p className="tabular-nums text-muted">{formatPhone(user.phone)}</p>
          <p className="text-label text-blue-700">{ROLE_LABELS[user.globalRole]}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setEditing(true)}
          icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
        >
          Modifier
        </Button>
      </Card>
      {isParticipant ? <PayoutCard /> : null}
      {isParticipant ? <NotificationPrefsCard /> : null}
      <InstallCard />
      <Button
        variant="secondary"
        block
        onClick={() => setConfirmLogout(true)}
        icon={<LogOut className="h-5 w-5" aria-hidden="true" />}
      >
        Se déconnecter
      </Button>
      {isParticipant ? <DeleteAccountCard /> : null}
      <EditProfileDialog open={editing} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={() => void logout()}
        title="Se déconnecter ?"
        confirmLabel="Se déconnecter"
        tone="blue"
      >
        Vous devrez saisir à nouveau votre numéro et un code SMS pour vous reconnecter.
      </ConfirmDialog>
    </div>
  );
}
