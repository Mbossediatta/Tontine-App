import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, CircleUser, LogOut } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Avatar, BrandLogo } from '@/components/ui';
import { useLogout } from '@/features/auth/useLogout';
import { cn } from '@/lib/cn';
import { fullName } from '@/lib/format';
import type { User } from '@/types';
import { UnreadCount } from './UnreadDot';

const ROLE_LABELS: Record<User['globalRole'], string> = {
  super_admin: 'Superadmin',
  admin: 'Administrateur',
  user: 'Participant',
};

/**
 * Menu du compte : bouton avec avatar, nom et rôle ; au clic, « Mon compte » et
 * « Se déconnecter ». Se ferme au clic à l'extérieur, avec Échap ou en changeant de page.
 */
function AccountMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const logout = useLogout();
  const { pathname } = useLocation();

  // Fermeture en changeant de page.
  useEffect(() => setOpen(false), [pathname]);

  // Fermeture au clic à l'extérieur ou avec Échap.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const itemClass =
    'flex min-h-touch w-full items-center gap-3 rounded-control px-3 text-left font-bold text-ink transition-colors duration-150 hover:bg-blue-50';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-touch items-center gap-2 rounded-control px-1.5 transition-colors duration-150 hover:bg-blue-50 sm:px-2"
      >
        <Avatar name={fullName(user)} src={user.avatarUrl} size="sm" />
        {/* Téléphone : seul l'avatar se voit ; ce texte donne un nom au bouton pour les
            lecteurs d'écran. Ordinateur : le nom et le rôle visibles suffisent. */}
        <span className="sr-only sm:hidden">Mon compte, {fullName(user)}</span>
        {/* Nom et rôle : masqués sur téléphone, l'avatar suffit. */}
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[180px] truncate font-bold text-ink">{fullName(user)}</span>
          <span className="block text-small text-muted">{ROLE_LABELS[user.globalRole]}</span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-60 rounded-card border border-line bg-white p-2 shadow-float"
        >
          {/* Sur téléphone, le nom n'est pas dans le bouton : on le rappelle ici. */}
          <p className="border-b border-line px-3 pb-2 pt-1 sm:hidden">
            <span className="block font-bold text-ink">{fullName(user)}</span>
            <span className="text-small text-muted">{ROLE_LABELS[user.globalRole]}</span>
          </p>
          <Link role="menuitem" to="/profil" className={itemClass}>
            <CircleUser className="h-5 w-5 text-blue-700" aria-hidden="true" />
            Mon compte
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className={cn(itemClass, 'text-danger hover:bg-danger-bg')}
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            Se déconnecter
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Barre du haut des espaces d'administration : logo (sur téléphone, où le menu latéral est caché),
 * cloche des notifications avec le nombre de non-lues, et menu du compte connecté.
 */
export function TopBar({ user, unread }: { user: User; unread: number }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white">
      <div className="mx-auto flex h-16 max-w-admin items-center gap-3 px-page sm:px-page-sm">
        <Link
          to="/admin"
          className="flex items-center gap-2 lg:hidden"
          aria-label="Tableau de bord"
        >
          <BrandLogo variant="mark" />
          <span className="font-display text-section text-blue-900">Calebasse</span>
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <NavLink
            to="/notifications"
            aria-label={unread > 0 ? `Notifications (${unread} non lues)` : 'Notifications'}
            className={({ isActive }) =>
              cn(
                'relative flex h-11 w-11 items-center justify-center rounded-control transition-colors duration-150 hover:bg-blue-50',
                isActive ? 'bg-blue-100 text-blue-700' : 'text-ink',
              )
            }
          >
            <Bell className="h-6 w-6" aria-hidden="true" />
            <UnreadCount count={unread} />
          </NavLink>
          <AccountMenu user={user} />
        </div>
      </div>
    </header>
  );
}
