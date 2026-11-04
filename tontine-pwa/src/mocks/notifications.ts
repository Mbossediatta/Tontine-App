import { subDays, subHours } from 'date-fns';
import type { AppNotification } from '@/types';

type Seed = Omit<AppNotification, 'id' | 'createdAt'> & { hoursAgo: number };

const SEEDS: Seed[] = [
  {
    userId: 'u-p1',
    type: 'reminder',
    title: 'Cotisation à payer',
    body: 'Tontine Famille : 4 500 FCFA à payer avant la date limite.',
    link: '/groupes/g-famille',
    read: false,
    hoursAgo: 3,
  },
  {
    userId: 'u-p1',
    type: 'beneficiary',
    title: 'Bénéficiaire du mois',
    body: 'Khady Ba reçoit la cagnotte du tour 3 de Tontine Famille.',
    link: '/groupes/g-famille',
    read: false,
    hoursAgo: 30,
  },
  {
    userId: 'u-p1',
    type: 'next_turn',
    title: 'Votre tour approche',
    body: 'Vous recevrez 45 000 FCFA au tour 4 de Tontine Famille.',
    link: '/groupes/g-famille',
    read: false,
    hoursAgo: 52,
  },
  {
    userId: 'u-p1',
    type: 'payout',
    title: 'Cagnotte reçue',
    body: 'Vous avez reçu 16 000 FCFA de Amies du quartier.',
    link: '/groupes/g-amies',
    read: true,
    hoursAgo: 24 * 40,
  },
  {
    userId: 'u-p1',
    type: 'payment',
    title: 'Paiement confirmé',
    body: 'Votre cotisation du tour 2 de Tontine Famille est bien reçue.',
    link: '/groupes/g-famille',
    read: true,
    hoursAgo: 24 * 25,
  },
  {
    userId: 'u-admin1',
    type: 'late',
    title: 'Membres en retard',
    body: 'Tontine Famille : 2 membres sont en retard sur le tour 3.',
    link: '/admin/groupes/g-famille',
    read: false,
    hoursAgo: 5,
  },
  {
    userId: 'u-admin1',
    type: 'join_request',
    title: 'Nouvelle demande d’adhésion',
    body: 'Abdoulaye Niang souhaite rejoindre Collègues du bureau.',
    link: '/admin/groupes/g-bureau',
    read: false,
    hoursAgo: 20,
  },
  {
    userId: 'u-admin1',
    type: 'payment',
    title: 'Paiement reçu',
    body: 'Mamadou Cissé a payé 4 500 FCFA pour Tontine Famille.',
    link: '/admin/groupes/g-famille',
    read: true,
    hoursAgo: 48,
  },
  {
    userId: 'u-admin2',
    type: 'join_request',
    title: 'Nouvelle demande d’adhésion',
    body: 'Abdoulaye Niang souhaite rejoindre Collègues du bureau.',
    link: '/admin/groupes/g-bureau',
    read: false,
    hoursAgo: 20,
  },
  {
    userId: 'u-super',
    type: 'info',
    title: 'Bienvenue',
    body: 'La plateforme compte 3 groupes et 15 utilisateurs.',
    link: '/admin',
    read: false,
    hoursAgo: 72,
  },
];

export function seedNotifications(now: Date = new Date()): AppNotification[] {
  return SEEDS.map(({ hoursAgo, ...seed }, index) => ({
    ...seed,
    id: `n-${index + 1}`,
    createdAt: (hoursAgo >= 24
      ? subDays(now, Math.floor(hoursAgo / 24))
      : subHours(now, hoursAgo)
    ).toISOString(),
  }));
}
