import { Card, CardTitle, Skeleton, Toggle } from '@/components/ui';
import { useNotificationPreferences } from '@/features/notifications/queries';
import { useAction } from '@/lib/query';
import { notificationService } from '@/services';
import type { NotificationPreferences } from '@/types';

const ITEMS: Array<{ key: keyof NotificationPreferences; label: string; description: string }> = [
  { key: 'reminders', label: 'Rappels de cotisation', description: 'Avant chaque date limite' },
  {
    key: 'beneficiary',
    label: 'Bénéficiaire du mois',
    description: 'À l’ouverture de chaque tour',
  },
  { key: 'payments', label: 'Paiements', description: 'Confirmations et reversements' },
];

export function NotificationPrefsCard() {
  const query = useNotificationPreferences();
  const save = useAction({
    action: (prefs: NotificationPreferences) => notificationService.updatePreferences(prefs),
    success: 'Préférences enregistrées',
  });

  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>Notifications</CardTitle>
      {query.data ? (
        ITEMS.map(({ key, label, description }) => (
          <Toggle
            key={key}
            label={label}
            description={description}
            checked={query.data[key]}
            disabled={save.isPending}
            onChange={(checked) => save.mutate({ ...query.data, [key]: checked })}
          />
        ))
      ) : (
        <Skeleton className="h-32 w-full" />
      )}
    </Card>
  );
}
