import { useState } from 'react';
import { CheckCheck, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AsyncContent, Button, Card, EmptyState } from '@/components/ui';
import { FilterChips } from '@/features/admin/components/ListToolbar';
import { useShowMore } from '@/features/admin/components/useShowMore';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { queryKeys, useAction } from '@/lib/query';
import { notificationService } from '@/services';
import type { AppNotification } from '@/types';
import { PushPromptCard } from './PushPromptCard';
import { useNotifications } from './queries';

type Filter = 'all' | 'unread';

/** Une notification : point bleu si non lue, flèche si elle mène à une page. */
function NotificationRow({
  notification,
  onOpen,
}: {
  notification: AppNotification;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-touch w-full items-center gap-3 p-4 text-left transition-colors duration-150 hover:bg-blue-50"
      >
        <span
          className={cn(
            'h-2.5 w-2.5 shrink-0 self-start rounded-full mt-2',
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
          <span className="mt-1 text-small text-muted">
            {formatRelative(notification.createdAt)}
          </span>
        </span>
        {notification.link ? (
          <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        ) : null}
      </button>
    </li>
  );
}

/** Un groupe de notifications (« Non lues », « Déjà lues ») sous son intitulé. */
function Section({
  title,
  items,
  onOpen,
  more,
}: {
  title: string;
  items: AppNotification[];
  onOpen: (notification: AppNotification) => void;
  more?: React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-label font-bold text-muted">{title}</h2>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onOpen={() => onOpen(notification)}
            />
          ))}
        </ul>
      </Card>
      {more}
    </section>
  );
}

/**
 * Notifications des administrateurs et du super administrateur.
 * Téléphone : une colonne. Ordinateur : la liste à gauche, l'encart d'activation des
 * notifications à droite (il ne repousse plus la liste vers le bas).
 */
export default function NotificationsPage() {
  const navigate = useNavigate();
  const query = useNotifications();
  const [filter, setFilter] = useState<Filter>('all');
  const markAll = useAction({
    action: () => notificationService.markAllRead(),
    success: 'Tout est marqué comme lu',
    refresh: [queryKeys.notifications],
  });
  const markOne = useAction({
    action: (id: string) => notificationService.markRead(id),
    refresh: [queryKeys.notifications],
  });

  const notifications = query.data ?? [];
  const unread = notifications.filter((n) => !n.read);
  const read = notifications.filter((n) => n.read);
  // Les notifications déjà lues s'accumulent : on les affiche par tranches de 20.
  const readPage = useShowMore(read, 20, filter);

  const open = (notification: AppNotification) => {
    if (!notification.read) markOne.mutate(notification.id);
    if (notification.link) navigate(notification.link);
  };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      {/* Titre et « Tout marquer lu » sur la même ligne, aussi sur téléphone. */}
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-page-title text-blue-900">Notifications</h1>
        {unread.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            loading={markAll.isPending}
            onClick={() => markAll.mutate()}
            icon={<CheckCheck className="h-4 w-4" aria-hidden="true" />}
          >
            <span className="sm:hidden">Tout lire</span>
            <span className="hidden sm:inline">Tout marquer comme lu</span>
          </Button>
        ) : null}
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="lg:order-last lg:sticky lg:top-24">
          <PushPromptCard />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <AsyncContent query={query}>
            {() =>
              notifications.length === 0 ? (
                <EmptyState
                  title="Aucune notification"
                  description="Les paiements, retards et demandes de vos groupes apparaîtront ici."
                />
              ) : (
                <>
                  <FilterChips
                    label="Afficher"
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { value: 'all', label: 'Toutes', count: notifications.length },
                      { value: 'unread', label: 'Non lues', count: unread.length },
                    ]}
                  />
                  <Section title={`Non lues · ${unread.length}`} items={unread} onOpen={open} />
                  {filter === 'all' ? (
                    <Section
                      title="Déjà lues"
                      items={readPage.visible}
                      onOpen={open}
                      more={readPage.more}
                    />
                  ) : null}
                  {filter === 'unread' && unread.length === 0 ? (
                    <EmptyState
                      title="Tout est lu"
                      description="Vous n’avez aucune notification en attente."
                    />
                  ) : null}
                </>
              )
            }
          </AsyncContent>
        </div>
      </div>
    </div>
  );
}
