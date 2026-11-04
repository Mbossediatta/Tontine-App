import { CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { AsyncContent, Button, Card, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { useAction } from '@/lib/query';
import { notificationService } from '@/services';
import type { AppNotification } from '@/types';
import { PushPromptCard } from './PushPromptCard';
import { useNotifications } from './queries';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const query = useNotifications();
  const markAll = useAction({
    action: () => notificationService.markAllRead(),
    success: 'Tout est marqué comme lu',
  });
  const markOne = useAction({ action: (id: string) => notificationService.markRead(id) });

  const open = (notification: AppNotification) => {
    if (!notification.read) markOne.mutate(notification.id);
    if (notification.link) navigate(notification.link);
  };

  const hasUnread = query.data?.some((n) => !n.read) ?? false;
  // Administrateurs : en-tête sans bandeau, comme leurs tableaux de bord.
  const { isAdmin } = useAuth();

  return (
    <div className={cn('flex flex-col gap-3', isAdmin && 'max-w-2xl')}>
      <PageHeader
        title="Notifications"
        plain={isAdmin}
        actions={
          hasUnread ? (
            <Button
              size="sm"
              variant={isAdmin ? 'outline' : 'onBlue'}
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
              icon={<CheckCheck className="h-4 w-4" aria-hidden="true" />}
            >
              Tout marquer comme lu
            </Button>
          ) : null
        }
      />
      <PushPromptCard />
      <AsyncContent query={query}>
        {(notifications) =>
          notifications.length === 0 ? (
            <EmptyState
              title="Aucune notification"
              description="Vos rappels et confirmations de paiement apparaîtront ici."
            />
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => open(notification)}
                      className="flex min-h-touch w-full gap-3 p-4 text-left hover:bg-blue-50"
                    >
                      <span
                        className={cn(
                          'mt-2 h-2.5 w-2.5 shrink-0 rounded-full',
                          notification.read ? 'bg-transparent' : 'bg-blue-700',
                        )}
                        aria-hidden="true"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn('text-ink', !notification.read && 'font-bold')}>
                          {notification.title}
                          {!notification.read ? <span className="sr-only"> (non lue)</span> : null}
                        </span>
                        <span className="text-label text-muted">{notification.body}</span>
                        <span className="mt-1 text-label text-muted">
                          {formatRelative(notification.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )
        }
      </AsyncContent>
    </div>
  );
}
