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

  // Guide de découverte de l'espace membre (bouton « ? » sur chaque page)
  'guide.help': 'Aide : expliquer cette page',
  'guide.progress': '{current} sur {total}',
  'guide.next': 'Suivant',
  'guide.back': 'Retour',
  'guide.skip': 'Passer',
  'guide.done': 'C’est compris',
  'guide.home.welcome.title': 'Bienvenue sur Calebasse',
  'guide.home.welcome.text':
    'Ce petit guide te montre l’application en quelques étapes. Appuie sur « ? » en bas de chaque page pour retrouver ses explications.',
  'guide.home.due.title': 'Ta prochaine cotisation',
  'guide.home.due.text':
    'Le montant à payer et la date limite. Appuie sur « Payer maintenant » pour payer avec ton téléphone.',
  'guide.home.groups.title': 'Tes groupes',
  'guide.home.groups.text':
    'Où tu en es ce mois-ci dans chaque groupe : payé, à payer ou en retard. Appuie sur un groupe pour voir son calendrier.',
  'guide.home.turns.title': 'Ton tour',
  'guide.home.turns.text': 'Quand tu recevras la cagnotte, et combien.',
  'guide.home.bell.title': 'Notifications',
  'guide.home.bell.text':
    'Les rappels, les paiements confirmés et les messages de ton administrateur arrivent ici.',
  'guide.nav.title': 'Le menu',
  'guide.nav.text':
    'Accueil, Groupes, Payer, Historique et Profil : chaque partie de l’application est à un appui.',
  'guide.groups.list.title': 'Tes groupes',
  'guide.groups.list.text':
    'Tous les groupes dont tu fais partie. Appuie sur un groupe pour voir son détail.',
  'guide.groups.open.title': 'Groupes ouverts',
  'guide.groups.open.text':
    'Les groupes de ta communauté que tu peux demander à rejoindre. L’administrateur valide ta demande.',
  'guide.groups.join.title': 'Rejoindre un groupe',
  'guide.groups.join.text':
    'Tu as reçu un lien ou un code d’invitation ? Appuie ici pour le saisir.',
  'guide.group.header.title': 'Ton groupe',
  'guide.group.header.text':
    'La cotisation, le tour en cours et ton statut. Le bouton « Payer » apparaît quand une cotisation t’attend.',
  'guide.group.facts.title': 'Les règles du groupe',
  'guide.group.facts.text':
    'Le montant, le rythme, la date limite, la pénalité de retard et les administrateurs.',
  'guide.group.calendar.title': 'Calendrier de passage',
  'guide.group.calendar.text':
    'Qui reçoit la cagnotte à chaque tour. Pour un tour à venir, tu peux proposer un échange à un autre membre.',
  'guide.group.members.title': 'Les membres',
  'guide.group.members.text': 'Les personnes qui cotisent avec toi dans ce groupe.',
  'guide.group.claim.title': 'Un problème ?',
  'guide.group.claim.text':
    'Paiement non reconnu ou cagnotte pas reçue : fais une réclamation, l’équipe te répond.',
  'guide.pay.steps.title': 'Payer en 3 étapes',
  'guide.pay.steps.text':
    'Choisis la cotisation, puis le moyen de paiement, puis vérifie et confirme.',
  'guide.pay.content.title': 'Rien n’est payé sans ton accord',
  'guide.pay.content.text':
    'Le montant, les frais du service de paiement et le total s’affichent avant que tu confirmes.',
  'guide.history.totals.title': 'Tes totaux',
  'guide.history.totals.text': 'Ce que tu as cotisé, et ce que tu as reçu.',
  'guide.history.filters.title': 'Filtrer',
  'guide.history.filters.text': 'Choisis un groupe ou une période pour retrouver un paiement.',
  'guide.history.list.title': 'Tes paiements',
  'guide.history.list.text': 'Appuie sur une ligne pour voir son détail et son reçu.',
  'guide.profile.account.title': 'Ton compte',
  'guide.profile.account.text':
    'Change ton code PIN et indique le numéro sur lequel tu reçois la cagnotte.',
  'guide.profile.language.title': 'Langue',
  'guide.profile.language.text': 'Choisis le français ou le wolof.',
  'guide.profile.notifications.title': 'Notifications',
  'guide.profile.notifications.text': 'Choisis les rappels que tu veux recevoir.',
  'guide.notifications.title': 'Tes notifications',
  'guide.notifications.text':
    'Les nouveaux messages sont en haut. « Tout marquer lu » les range une fois que tu les as vus.',
} as const;

export type MessageKey = keyof typeof fr;
