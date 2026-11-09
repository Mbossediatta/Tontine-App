import {
  ArrowLeftRight,
  ChartColumn,
  CreditCard,
  HandCoins,
  History,
  Home,
  LayoutDashboard,
  Megaphone,
  PlusCircle,
  Scale,
  ScrollText,
  ShieldAlert,
  Settings,
  ShieldCheck,
  User,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '@/i18n';
import type { GlobalRole } from '@/types';

export interface NavItem {
  to: string;
  label: string;
  /** Libellé court pour la barre du bas. */
  shortLabel?: string;
  /** Rubriques du participant : libellé traduit dans la langue choisie (remplace `label`). */
  labelKey?: MessageKey;
  icon: LucideIcon;
  /** Affiche le point des notifications non lues. */
  showUnread?: boolean;
  /**
   * Rubrique principale : affichée dans la barre du bas sur téléphone. Quand un menu
   * en compte plus de 5, les autres passent dans le panneau « Plus ».
   */
  primary?: boolean;
}

const DASHBOARD: NavItem = {
  to: '/admin',
  label: 'Tableau de bord',
  shortLabel: 'Tableau',
  icon: LayoutDashboard,
  primary: true,
};
const HOME: NavItem = { to: '/', label: 'Accueil', labelKey: 'nav.home', icon: Home };
const ADMIN_HOME: NavItem = {
  ...HOME,
  to: '/espace-membre',
  label: 'Espace membre',
  labelKey: undefined,
};
const GROUPS: NavItem = { to: '/groupes', label: 'Groupes', labelKey: 'nav.groups', icon: Users };
const MEMBER_PAY: NavItem = {
  to: '/payer',
  label: 'Payer',
  labelKey: 'nav.pay',
  icon: CreditCard,
  primary: true,
};
const MEMBER_HISTORY: NavItem = {
  to: '/historique',
  label: 'Historique',
  labelKey: 'nav.history',
  icon: History,
  primary: true,
};
const ADMIN_GROUPS: NavItem = {
  to: '/admin/mes-groupes',
  label: 'Mes groupes',
  icon: UsersRound,
  primary: true,
};
const ADMIN_CONTRIBUTIONS: NavItem = {
  to: '/admin/cotisations',
  label: 'Cotisations',
  shortLabel: 'Cotis.',
  icon: HandCoins,
  primary: true,
};
const CREATE_GROUP: NavItem = {
  to: '/admin/groupes/nouveau',
  label: 'Créer un groupe',
  shortLabel: 'Créer',
  icon: PlusCircle,
  primary: true,
};
const PROFILE: NavItem = { to: '/profil', label: 'Profil', labelKey: 'nav.profile', icon: User };

/**
 * Les 12 rubriques du back-office (cahier du super administrateur), dans son ordre.
 * Libellés courts pour tenir sur une ligne ; les pages portent le titre complet
 * (« Litiges et remboursements », « Notifications et annonces »…).
 * « Mon compte » et ses notifications sont dans la barre du haut (TopBar), pas ici.
 * En dernier, « Espace membre » : ses propres cotisations s'il est membre d'un groupe.
 */
const SUPER_ADMIN_ITEMS: NavItem[] = [
  DASHBOARD,
  {
    to: '/admin/administrateurs',
    label: 'Administrateurs',
    shortLabel: 'Admins',
    icon: ShieldCheck,
  },
  {
    to: '/admin/communautes',
    label: 'Communautés',
    icon: UsersRound,
    primary: true,
  },
  { to: '/admin/groupes', label: 'Groupes', icon: UsersRound, primary: true },
  { to: '/admin/membres', label: 'Membres', icon: Users, primary: true },
  {
    to: '/admin/transactions',
    label: 'Transactions',
    shortLabel: 'Paiements',
    icon: ArrowLeftRight,
    primary: true,
  },
  { to: '/admin/versements', label: 'Versements', icon: HandCoins },
  { to: '/admin/litiges', label: 'Litiges', icon: Scale },
  {
    to: '/admin/annonces',
    label: 'Annonces',
    icon: Megaphone,
  },
  {
    to: '/admin/rapports',
    label: 'Rapports',
    icon: ChartColumn,
  },
  { to: '/admin/audit', label: 'Journal d’audit', shortLabel: 'Audit', icon: ScrollText },
  { to: '/admin/securite', label: 'Sécurité', icon: ShieldAlert },
  { to: '/admin/parametres', label: 'Paramètres', icon: Settings },
  // S'il cotise lui-même dans un groupe : ses cotisations et ses tours, comme un admin.
  ADMIN_HOME,
];

/**
 * Menu selon le rôle :
 * - super administrateur : les rubriques du back-office et son espace membre (compte et
 *   notifications : barre du haut) ;
 * - administrateur : tableau de bord et groupes qu'il gère (compte et notifications : barre du haut) ;
 * - participant : ses tontines.
 */
export function navItemsFor(role: GlobalRole | undefined): NavItem[] {
  switch (role) {
    case 'super_admin':
      return SUPER_ADMIN_ITEMS;
    case 'admin':
      return [DASHBOARD, ADMIN_GROUPS, ADMIN_CONTRIBUTIONS, CREATE_GROUP, ADMIN_HOME];
    default:
      return [HOME, GROUPS, MEMBER_PAY, MEMBER_HISTORY, PROFILE];
  }
}

/** Ces liens ne s'allument que sur leur page exacte (pas sur leurs sous-pages). */
export function isExactNavLink(to: string): boolean {
  return to === '/' || to === '/admin';
}
