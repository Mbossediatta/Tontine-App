import { useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { BrandLogo, Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/hooks/useAuth';
import { fullName } from '@/lib/format';
import type { User } from '@/types';
import { isExactNavLink, type NavItem } from './navItems';
import { UnreadDot } from './UnreadDot';

interface NavProps {
  items: NavItem[];
  unread: number;
}

/** Plus de 5 rubriques : les principales restent en bas, les autres vont dans « Plus ». */
const MAX_TABS = 5;

/** Un onglet de la barre du bas : icône dans une pastille (bleue si active) et libellé court. */
function TabContent({
  icon: Icon,
  label,
  active,
  dot,
}: {
  icon: NavItem['icon'];
  label: string;
  active: boolean;
  dot?: ReactNode;
}) {
  return (
    <>
      <span
        className={cn(
          'relative flex h-8 w-14 items-center justify-center rounded-pill transition-colors duration-150',
          active && 'bg-blue-100',
        )}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
        {dot}
      </span>
      <span className="max-w-full truncate px-1">{label}</span>
    </>
  );
}

const tabClass = (active: boolean) =>
  cn(
    'flex min-h-[64px] h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-bold leading-4 sm:text-[12px]',
    active ? 'text-blue-700' : 'text-muted',
  );

/**
 * Barre d'onglets en bas d'écran (mobile et tablette).
 * Jusqu'à 5 rubriques : toutes en onglets. Au-delà (super administrateur) : les
 * rubriques « primary » en onglets, et un onglet « Plus » qui ouvre la liste complète.
 */
export function BottomNav({ items, unread }: NavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const overflow = items.length > MAX_TABS;
  const tabs = overflow ? items.filter((item) => item.primary) : items;
  const hidden = overflow ? items.filter((item) => !item.primary) : [];
  // « Plus » s'allume quand la page ouverte est l'une des rubriques cachées.
  const moreActive = hidden.some((item) =>
    isExactNavLink(item.to) ? pathname === item.to : pathname.startsWith(item.to),
  );

  return (
    <>
      <nav
        data-guide="nav"
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto flex h-16 max-w-participant">
          {tabs.map(({ to, label, shortLabel, icon, showUnread }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={isExactNavLink(to)}
                className={({ isActive }) => tabClass(isActive)}
              >
                {({ isActive }) => (
                  <TabContent
                    icon={icon}
                    label={shortLabel ?? label}
                    active={isActive}
                    dot={showUnread ? <UnreadDot count={unread} /> : null}
                  />
                )}
              </NavLink>
            </li>
          ))}
          {overflow ? (
            <li className="flex-1">
              <button
                type="button"
                className={tabClass(moreActive)}
                aria-haspopup="dialog"
                onClick={() => setMoreOpen(true)}
              >
                <TabContent
                  icon={Menu}
                  label="Plus"
                  active={moreActive}
                  dot={hidden.some((item) => item.showUnread) ? <UnreadDot count={unread} /> : null}
                />
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      {/* Panneau « Plus » : toutes les rubriques, en grandes cases faciles à toucher. */}
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Autres rubriques">
        <ul className="grid grid-cols-2 gap-2">
          {hidden.map(({ to, label, icon: Icon, showUnread }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={isExactNavLink(to)}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-[72px] flex-col items-start justify-center gap-1 rounded-control border p-3 text-label font-bold transition-colors duration-150',
                    isActive
                      ? 'border-blue-700 bg-blue-100 text-blue-700'
                      : 'border-line bg-white text-ink hover:border-blue-700',
                  )
                }
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {showUnread ? <UnreadDot count={unread} onSide /> : null}
                </span>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

/** Carte « Rôle » en bas du menu latéral : rappelle qui est connecté et avec quels droits. */
function roleCard(user: User): { title: string; detail: string } {
  switch (user.globalRole) {
    case 'super_admin':
      return { title: 'Superadmin', detail: 'Accès complet à la plateforme' };
    case 'admin':
      return { title: `Admin · ${fullName(user)}`, detail: 'Gère ses groupes de tontine' };
    default:
      return { title: fullName(user), detail: 'Participant' };
  }
}

/**
 * Menu latéral blanc (écrans ≥ 1024 px) : logo officiel en haut, liens avec icône,
 * lien actif sur fond bleu clair, carte du rôle tout en bas.
 * `withTopBar` : l'identité est déjà affichée dans la barre du haut, la carte du rôle
 * est donc retirée.
 */
export function SideNav({
  items,
  unread,
  withTopBar = false,
}: NavProps & { withTopBar?: boolean }) {
  const { user } = useAuth();
  const role = user && !withTopBar ? roleCard(user) : null;

  return (
    <nav
      data-guide="nav"
      aria-label="Navigation principale"
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-white p-4 lg:flex"
    >
      <div className="mb-4 shrink-0 px-2">
        <BrandLogo />
      </div>

      {/*
        La liste tient sur un écran d'ordinateur. Si la fenêtre est très basse, elle
        peut encore défiler, mais sans barre de défilement visible (no-scrollbar).
      */}
      <ul className="no-scrollbar -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
        {items.map(({ to, label, icon: Icon, showUnread }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={isExactNavLink(to)}
              className={({ isActive }) =>
                cn(
                  // 40 px de haut : les rubriques du super admin tiennent sans défilement.
                  'flex min-h-[40px] items-center gap-3 rounded-control px-3 transition-colors duration-150',
                  isActive
                    ? 'bg-blue-100 font-bold text-blue-700'
                    : 'text-ink hover:bg-blue-50 hover:text-blue-700',
                )
              }
            >
              <span className="relative">
                <Icon className="h-5 w-5" aria-hidden="true" />
                {showUnread ? <UnreadDot count={unread} onSide /> : null}
              </span>
              {label}
            </NavLink>
          </li>
        ))}
      </ul>

      {role ? (
        // mt-auto : la carte du rôle reste collée en bas du menu.
        <div className="mt-3 shrink-0 rounded-card bg-green-100 px-4 py-3">
          <p className="text-small uppercase tracking-wide text-green-700">Rôle</p>
          <p className="mt-1 font-bold text-ink">{role.title}</p>
          <p className="text-label text-muted">{role.detail}</p>
        </div>
      ) : null}
    </nav>
  );
}
