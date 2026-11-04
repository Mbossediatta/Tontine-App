import { useState, type ReactNode } from 'react';
import { ChevronRight, KeyRound, LogOut, Wallet } from 'lucide-react';
import { Toggle } from '@/components/ui';
import { useLogout } from '@/features/auth/useLogout';
import { useNotificationPreferences } from '@/features/notifications/queries';
import { DeleteAccountCard } from '@/features/profile/DeleteAccountCard';
import { EditProfileDialog } from '@/features/profile/EditProfileDialog';
import { useCurrentUser } from '@/hooks/useAuth';
import { formatPhone, fullName, initials } from '@/lib/format';
import { useAction } from '@/lib/query';
import { notificationService } from '@/services';
import type { NotificationPreferences } from '@/types';
import { ChangePinSheet } from '../components/ChangePinSheet';
import { PayoutSheet } from '../components/PayoutSheet';
import { Button } from '../ui/Button';
import { Card, PageTitle, SectionHeader } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';

const PREFERENCES: Array<{ key: keyof NotificationPreferences; label: string; description: string }> = [
  { key: 'reminders', label: 'Rappels de cotisation', description: 'Avant chaque date limite' },
  { key: 'payments', label: 'Paiements', description: 'Confirmation de chaque paiement' },
  { key: 'beneficiary', label: 'Bénéficiaire du mois', description: 'Qui reçoit la cagnotte' },
];

/** Ligne de réglage cliquable : icône, libellé, valeur actuelle, chevron. */
function SettingRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100"
      >
        <span className="text-slate-600" aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{label}</span>
          {value ? <span className="block text-[13px] text-slate-600">{value}</span> : null}
        </span>
        <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Préférences de notifications : un interrupteur par type, enregistré aussitôt. */
function NotificationPreferencesList() {
  const query = useNotificationPreferences();
  const save = useAction({
    action: (prefs: NotificationPreferences) => notificationService.updatePreferences(prefs),
    success: 'Préférences enregistrées',
  });
  if (!query.data) return <Skeleton className="h-40 rounded-xl" />;
  const prefs = query.data;
  return (
    <Card className="divide-y divide-slate-200 px-4">
      {PREFERENCES.map(({ key, label, description }) => (
        <div key={key} className="py-2">
          <Toggle
            label={label}
            description={description}
            checked={prefs[key]}
            disabled={save.isPending}
            onChange={(checked) => save.mutate({ ...prefs, [key]: checked })}
          />
        </div>
      ))}
    </Card>
  );
}

/** Profil : identité, sécurité (PIN), réception de la cagnotte, notifications, déconnexion. */
export default function MemberProfilePage() {
  const user = useCurrentUser();
  const logout = useLogout();
  const [editing, setEditing] = useState(false);
  const [changingPin, setChangingPin] = useState(false);
  const [payout, setPayout] = useState(false);

  const payoutLabel = user.payoutPhone
    ? `${user.payoutMethod === 'orange_money' ? 'Orange Money' : 'Wave'} · ${formatPhone(user.payoutPhone)}`
    : 'Aucun numéro : à renseigner pour recevoir ta cagnotte';

  return (
    <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
      <PageTitle>Profil</PageTitle>

      <section className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-100 text-[15px] font-bold text-green-800"
        >
          {initials(user)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[18px] font-bold leading-6">{fullName(user)}</p>
          <p className="text-[13px] tabular-nums text-slate-600">{formatPhone(user.phone)}</p>
        </div>
        <Button variant="quiet" onClick={() => setEditing(true)}>
          Modifier
        </Button>
      </section>

      <section aria-labelledby="account">
        <SectionHeader id="account" title="Compte" />
        <Card>
          <ul className="divide-y divide-slate-200">
            <SettingRow
              icon={<KeyRound className="h-5 w-5" />}
              label="Changer mon code PIN"
              value="Le code qui ouvre l’application"
              onClick={() => setChangingPin(true)}
            />
            <SettingRow
              icon={<Wallet className="h-5 w-5" />}
              label="Recevoir la cagnotte"
              value={payoutLabel}
              onClick={() => setPayout(true)}
            />
          </ul>
        </Card>
      </section>

      <section aria-labelledby="notifications">
        <SectionHeader id="notifications" title="Notifications" />
        <NotificationPreferencesList />
      </section>

      <Button
        variant="secondary"
        block
        icon={<LogOut className="h-5 w-5" aria-hidden="true" />}
        onClick={() => void logout()}
      >
        Se déconnecter
      </Button>

      <DeleteAccountCard />

      <EditProfileDialog open={editing} onClose={() => setEditing(false)} />
      <ChangePinSheet open={changingPin} onClose={() => setChangingPin(false)} />
      <PayoutSheet open={payout} onClose={() => setPayout(false)} />
    </div>
  );
}
