import { ChevronLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useShowMore } from '@/features/admin/components/useShowMore';
import { PushPromptCard } from '@/features/notifications/PushPromptCard';
import { useNotifications } from '@/features/notifications/queries';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { queryKeys, useAction } from '@/lib/query';
import { notificationService } from '@/services';
import type { AppNotification } from '@/types';
import { Button } from '../ui/Button';
import { PageGuide } from '../guide/PageGuide';
import { Card } from '../ui/Card';
import { EmptyState, ErrorBlock } from '../ui/EmptyState';
import { ListSkeleton } from '../ui/Skeleton';

/** Une notification : point vert si non lue, titre, texte, depuis quand. */
function NotificationRow({ item, onOpen }: { item: AppNotification; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100"
      >
        <span className="flex w-2.5 shrink-0 justify-center pt-1.5" aria-hidden="true">
          {!item.read ? <span className="h-2.5 w-2.5 rounded-full bg-green-600" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[15px]', item.read ? 'font-medium' : 'font-semibold')}>
            {item.title}
            {!item.read ? <span className="sr-only"> (non lue)</span> : null}
          </span>
          <span className="mt-0.5 block text-[13px] leading-5 text-slate-600">{item.body}</span>
          <span className="mt-1 block text-[13px] text-slate-600">
            {formatRelative(item.createdAt)}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Centre de notifications : les non lues d'abord ; ouvrir une notification la marque comme lue. */
export default function MemberNotificationsPage() {
  const navigate = useNavigate();
  const query = useNotifications();
  const markAll = useAction({
    action: () => notificationService.markAllRead(),
    success: 'Tout est marqué comme lu',
    refresh: [queryKeys.notifications],
  });
  const markOne = useAction({
    action: (id: string) => notificationService.markRead(id),
    refresh: [queryKeys.notifications],
  });

  const items = query.data ?? [];
  const unread = items.filter((n) => !n.read);
  const read = items.filter((n) => n.read);
  // Les notifications lues s'accumulent : on les affiche par tranches de 20.
  const readPage = useShowMore(read, 20, null);

  const open = (item: AppNotification) => {
    if (!item.read) markOne.mutate(item.id);
    if (item.link) navigate(item.link);
  };

  return (
    <div className="flex flex-col gap-4 motion-safe:animate-fade-in lg:mx-auto lg:w-full lg:max-w-participant">
      <header className="flex min-h-[48px] items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link
            to="/"
            aria-label="Retour à l’accueil"
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <h1 className="text-[18px] font-bold leading-6">Notifications</h1>
        </div>
        {unread.length > 0 ? (
          <Button variant="quiet" loading={markAll.isPending} onClick={() => markAll.mutate()}>
            Tout marquer lu
          </Button>
        ) : null}
      </header>

      <PushPromptCard />

      {query.isPending ? (
        <ListSkeleton rows={4} />
      ) : query.isError ? (
        <ErrorBlock onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Aucune notification"
          description="Tu seras prévenu ici des rappels de cotisation, des paiements et des tours."
        />
      ) : (
        <div data-guide="notifications-list" className="flex flex-col gap-4">
          {unread.length > 0 ? (
            <section aria-label="Non lues">
              <h2 className="mb-2 text-[13px] font-semibold text-slate-600">
                Non lues · {unread.length}
              </h2>
              <Card>
                <ul className="divide-y divide-slate-200">
                  {unread.map((item) => (
                    <NotificationRow key={item.id} item={item} onOpen={() => open(item)} />
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}
          {read.length > 0 ? (
            <section aria-label="Déjà lues">
              <h2 className="mb-2 text-[13px] font-semibold text-slate-600">Déjà lues</h2>
              <Card>
                <ul className="divide-y divide-slate-200">
                  {readPage.visible.map((item) => (
                    <NotificationRow key={item.id} item={item} onOpen={() => open(item)} />
                  ))}
                </ul>
              </Card>
              {readPage.remaining > 0 ? (
                <Button variant="secondary" block className="mt-3" onClick={readPage.loadMore}>
                  Voir plus ({readPage.remaining} restante{readPage.remaining > 1 ? 's' : ''})
                </Button>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
      <PageGuide id="notifications" ready={!query.isPending} />
    </div>
  );
}
