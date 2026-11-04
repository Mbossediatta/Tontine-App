// Textes de l'interface en wolof (orthographe officielle, alphabet latin).
// PREMIÈRE VERSION À FAIRE RELIRE par une personne qui parle et écrit le wolof :
// les termes d'argent et de tontine doivent être ceux qu'emploient les utilisateurs.
import type { MessageKey } from './fr';

export const wo: Record<MessageKey, string> = {
  // Barre de navigation du participant
  'nav.home': 'Kër',
  'nav.groups': 'Mbootaay',
  'nav.pay': 'Fey',
  'nav.history': 'Li weesu',
  'nav.profile': 'Sama kont',

  // Statuts de paiement (pastilles)
  'status.paid': 'Fey na',
  'status.pending': 'Wara fey',
  'status.late': 'Yéex na',
  'status.failed': 'Antuwul',
  'status.refunded': 'Delloo nañu',

  // Échéances
  'deadline.inDays': 'Ci {count} fan',
  'deadline.tomorrow': 'Ëllëg',
  'deadline.today': 'Tey',
  'deadline.lateOne': 'Yéex na 1 fan',
  'deadline.lateMany': 'Yéex na {count} fan',

  // Montants par période
  'freq.monthly': '{amount} ci weer wi',
  'freq.biweekly': '{amount} ci ñaari ayu-bés yi',
  'freq.weekly': '{amount} ci ayu-bés bi',
  'freq.daily': '{amount} ci bés bu nekk, ci pàcc bu nekk',
  'period.month': 'Natt bu {month}',
  'period.round': 'Wàll {number}',

  // Accueil du participant
  'home.hello': 'Nanga def, {name}',
  'home.notifications': 'Yégle yi',
  'home.notificationsUnread': 'Yégle yi, {count} yu bees',
  'home.loading': 'Mu ngi yeb',
  'home.nextDue': 'Natt bi ci topp',
  'home.before': 'Balaa {date}',
  'home.penaltyIncluded': '· ak alamaan bi',
  'home.payNow': 'Fey léegi',
  'home.otherDueOne': 'Beneen natt boo wara fey',
  'home.otherDueMany': '{count} natt yu des yoo wara fey',
  'home.upToDate': 'Fey nga lépp',
  'home.upToDateNext': 'Fey nga sa natt yépp. Natt bi ci topp: {date}.',
  'home.upToDateNone': 'Amul natt boo wara fey léegi.',
  'home.thisMonth': 'Weer wii',
  'home.myGroups': 'Samay mbootaay',
  'home.round': 'wàll {number}/{total}',
  'home.notStarted': 'Tàmbaleegul',
  'home.finished': 'Jeex na',
  'home.myTurn': 'Sama wàll',
  'home.turnNotSet': 'Sa wàll leeragul: dinañu dogal kan moo jëkk bu mbootaay bi tàmbalee.',
  'home.youReceiveIn': 'Dinga jot ci {month}',
  'home.turnOf': '{group} · wàll {number}',
  'home.emptyTitle': 'Bokkagoo ci benn mbootaay',
  'home.emptyText': 'Laajal kodu woote bi ci njiitu sa natt.',
  'home.join': 'Bokk ci mbootaay',
  'home.joinAnother': 'Bokk ci beneen mbootaay',

  // Choix de la langue (Profil)
  'language.title': 'Làkk',
  'language.hint': 'Tekki ci wolof bi mu ngi ñuy defar: yenn xët yi ci farañse lañu des.',
};
