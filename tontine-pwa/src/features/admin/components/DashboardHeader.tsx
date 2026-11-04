import type { ReactNode } from 'react';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UnreadDot } from '@/components/layout/UnreadDot';
import { useUnreadCount } from '@/features/notifications/queries';

interface DashboardHeaderProps {
  title: string;
  subtitle: ReactNode;
  /** Boutons à droite (après la cloche des notifications). */
  actions?: ReactNode;
  /** Cloche des notifications ; désactivée quand la barre du haut l'affiche déjà. */
  showBell?: boolean;
}

/** Cloche des notifications, avec le point vert s'il y en a de non lues. */
function NotificationBell() {
  const unread = useUnreadCount();
  return (
    <Link
      to="/notifications"
      aria-label="Notifications"
      className="relative flex h-11 w-11 items-center justify-center rounded-control border border-line bg-white text-ink transition-colors duration-150 hover:border-blue-700 hover:text-blue-700"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      <UnreadDot count={unread} onSide />
    </Link>
  );
}

/**
 * En-tête des tableaux de bord : grand titre et sous-titre à gauche,
 * cloche des notifications et actions principales à droite.
 * Sur mobile, les actions passent sous le titre.
 */
export function DashboardHeader({
  title,
  subtitle,
  actions,
  showBell = true,
}: DashboardHeaderProps) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-page-title text-blue-900">{title}</h1>
        <p className="mt-1 text-body text-muted">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showBell ? <NotificationBell /> : null}
        {actions}
      </div>
    </header>
  );
}
