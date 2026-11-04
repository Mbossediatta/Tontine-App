// Textes de l'interface en français (langue de référence).
// Chaque clé doit aussi exister dans wo.ts : TypeScript le vérifie.
// Les accolades {nom} sont remplacées à l'affichage (voir useT).

export const fr = {
  // Barre de navigation du participant
  'nav.home': 'Accueil',
  'nav.groups': 'Groupes',
  'nav.pay': 'Payer',
  'nav.history': 'Historique',
  'nav.profile': 'Profil',

  // Statuts de paiement (pastilles)
  'status.paid': 'Payé',
  'status.pending': 'À payer',
  'status.late': 'En retard',
  'status.failed': 'Échoué',
  'status.refunded': 'Remboursé',

  // Échéances
  'deadline.inDays': 'Dans {count} jours',
  'deadline.tomorrow': 'Demain',
  'deadline.today': 'Aujourd’hui',
  'deadline.lateOne': 'En retard de 1 jour',
  'deadline.lateMany': 'En retard de {count} jours',

  // Montants par période
  'freq.monthly': '{amount} par mois',
  'freq.biweekly': '{amount} par quinzaine',
  'freq.weekly': '{amount} par semaine',
  'freq.daily': '{amount} par jour et par part',
  'period.month': 'Cotisation de {month}',
  'period.round': 'Tour {number}',

  // Accueil du participant
  'home.hello': 'Bonjour {name}',
  'home.notifications': 'Notifications',
  'home.notificationsUnread': 'Notifications, {count} non lues',
  'home.loading': 'Chargement',
  'home.nextDue': 'Prochaine cotisation',
  'home.before': 'Avant le {date}',
  'home.penaltyIncluded': '· pénalité incluse',
  'home.payNow': 'Payer maintenant',
  'home.otherDueOne': '1 autre cotisation à payer',
  'home.otherDueMany': '{count} autres cotisations à payer',
  'home.upToDate': 'Tu es à jour',
  'home.upToDateNext':
    'Toutes tes cotisations du moment sont payées. Prochaine échéance le {date}.',
  'home.upToDateNone': 'Aucune cotisation à payer pour le moment.',
  'home.thisMonth': 'Ce mois-ci',
  'home.myGroups': 'Mes groupes',
  'home.round': 'tour {number}/{total}',
  'home.notStarted': 'Pas commencé',
  'home.finished': 'Terminé',
  'home.myTurn': 'Mon tour',
  'home.turnNotSet':
    'Ton tour n’est pas encore fixé : l’ordre de passage sera décidé au démarrage du groupe.',
  'home.youReceiveIn': 'Tu reçois en {month}',
  'home.turnOf': '{group} · tour {number}',
  'home.emptyTitle': 'Tu n’as encore rejoint aucun groupe',
  'home.emptyText': 'Demande le code d’invitation à l’administrateur de ta tontine.',
  'home.join': 'Rejoindre un groupe',
  'home.joinAnother': 'Rejoindre un autre groupe',

  // Choix de la langue (Profil)
  'language.title': 'Langue',
  'language.hint': 'La traduction en wolof est en cours : certains écrans restent en français.',
} as const;

export type MessageKey = keyof typeof fr;
