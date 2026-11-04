import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PageSkeleton } from '@/components/ui';
import { useUnreadCount } from '@/features/notifications/queries';
import { useAuth } from '@/hooks/useAuth';
import { useInactivityLock } from '@/hooks/useInactivityLock';
import { cn } from '@/lib/cn';
import { BottomNav, SideNav } from './BottomNav';
import { navItemsFor } from './navItems';
import { TopBar } from './TopBar';

/**
 * Structure des écrans connectés : navigation du bas (mobile) ou menu latéral blanc (≥ 1024 px).
 * Largeur de contenu : 560 px côté participant, 1280 px pour l'administration.
 * Accueil, profil et notifications d'un administrateur prennent la largeur d'administration
 * (alignés sur ses tableaux de bord ; la page limite elle-même sa colonne).
 */
export function AppShell() {
  const { user } = useAuth();
  const unread = useUnreadCount();
  const { pathname } = useLocation();
  const items = navItemsFor(user?.globalRole);
  // Sans activité pendant un moment, l'application se verrouille (PIN redemandé).
  useInactivityLock();
  const isAdminRole = user?.globalRole === 'admin' || user?.globalRole === 'super_admin';
  const isAdminArea =
    pathname.startsWith('/admin') ||
    (user?.globalRole === 'admin' && pathname === '/') ||
    (isAdminRole && (pathname === '/profil' || pathname === '/notifications'));

  // Les espaces d'administration partagent la barre du haut : compte et notifications.
  const withTopBar = user?.globalRole === 'admin' || user?.globalRole === 'super_admin';

  return (
    <div className={cn('min-h-screen bg-blue-50 lg:pl-60', user?.globalRole === 'user' && 'theme-member')}>
      <SideNav items={items} unread={unread} withTopBar={withTopBar} />
      {withTopBar && user ? <TopBar user={user} unread={unread} /> : null}
      <main
        className={cn(
          'mx-auto w-full px-page pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4 sm:px-page-sm lg:pb-10 lg:pt-6',
          isAdminArea ? 'max-w-admin' : 'max-w-participant',
        )}
      >
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav items={items} unread={unread} />
    </div>
  );
}
