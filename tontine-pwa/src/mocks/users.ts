import { startOfMonth, subMonths } from 'date-fns';
import type { User } from '@/types';

type Seed = Pick<User, 'id' | 'firstName' | 'lastName' | 'phone' | 'globalRole'> &
  Partial<Pick<User, 'payoutMethod'>>;

const SEEDS: Seed[] = [
  {
    id: 'u-super',
    firstName: 'Aminata',
    lastName: 'Sow',
    phone: '770100101',
    globalRole: 'super_admin',
  },
  {
    id: 'u-admin1',
    firstName: 'Moussa',
    lastName: 'Diop',
    phone: '771234567',
    globalRole: 'admin',
    payoutMethod: 'wave',
  },
  {
    id: 'u-admin2',
    firstName: 'Fatou',
    lastName: 'Ndiaye',
    phone: '781234567',
    globalRole: 'admin',
    payoutMethod: 'orange_money',
  },
  {
    id: 'u-p1',
    firstName: 'Awa',
    lastName: 'Fall',
    phone: '772345678',
    globalRole: 'user',
    payoutMethod: 'wave',
  },
  {
    id: 'u-p2',
    firstName: 'Ibrahima',
    lastName: 'Sarr',
    phone: '763456789',
    globalRole: 'user',
    payoutMethod: 'orange_money',
  },
  {
    id: 'u-p3',
    firstName: 'Khady',
    lastName: 'Ba',
    phone: '704567890',
    globalRole: 'user',
    payoutMethod: 'wave',
  },
  {
    id: 'u-p4',
    firstName: 'Cheikh',
    lastName: 'Mbaye',
    phone: '775678901',
    globalRole: 'user',
    payoutMethod: 'wave',
  },
  {
    id: 'u-p5',
    firstName: 'Mariama',
    lastName: 'Gueye',
    phone: '786789012',
    globalRole: 'user',
    payoutMethod: 'orange_money',
  },
  {
    id: 'u-p6',
    firstName: 'Ousmane',
    lastName: 'Faye',
    phone: '767890123',
    globalRole: 'user',
    payoutMethod: 'wave',
  },
  {
    id: 'u-p7',
    firstName: 'Ndèye',
    lastName: 'Seck',
    phone: '708901234',
    globalRole: 'user',
    payoutMethod: 'wave',
  },
  {
    id: 'u-p8',
    firstName: 'Mamadou',
    lastName: 'Cissé',
    phone: '779012345',
    globalRole: 'user',
    payoutMethod: 'orange_money',
  },
  {
    id: 'u-p9',
    firstName: 'Aïssatou',
    lastName: 'Diallo',
    phone: '780123456',
    globalRole: 'user',
    payoutMethod: 'wave',
  },
  {
    id: 'u-p10',
    firstName: 'Babacar',
    lastName: 'Thiam',
    phone: '761234098',
    globalRole: 'user',
    payoutMethod: 'wave',
  },
  { id: 'u-p11', firstName: 'Coumba', lastName: 'Kane', phone: '702345109', globalRole: 'user' },
  {
    id: 'u-p12',
    firstName: 'Abdoulaye',
    lastName: 'Niang',
    phone: '773456210',
    globalRole: 'user',
    payoutMethod: 'orange_money',
  },
];

/** Identifiants des comptes de démonstration (leur PIN est créé d'avance). */
export const SEEDED_USER_IDS = SEEDS.map((seed) => seed.id);

/** Comptes inscrits ce mois-ci (alimente « +N ce mois » du tableau de bord super admin). */
const NEW_THIS_MONTH = new Set(['u-p10', 'u-p11', 'u-p12']);

export function seedUsers(now: Date = new Date()): User[] {
  return SEEDS.map((seed) => ({
    ...seed,
    isSuspended: false,
    payoutPhone: seed.payoutMethod ? seed.phone : undefined,
    createdAt: (NEW_THIS_MONTH.has(seed.id) ? startOfMonth(now) : subMonths(now, 6)).toISOString(),
  }));
}

/** Comptes proposés par le sélecteur de démonstration de l'écran de connexion. */
export const DEMO_ACCOUNTS = [
  { userId: 'u-super', label: 'Super administrateur', detail: 'Aminata Sow' },
  { userId: 'u-admin1', label: 'Administrateur', detail: 'Moussa Diop – Tontine Famille' },
  { userId: 'u-admin2', label: 'Administratrice', detail: 'Fatou Ndiaye – Collègues du bureau' },
  { userId: 'u-p1', label: 'Participante', detail: 'Awa Fall' },
] as const;
