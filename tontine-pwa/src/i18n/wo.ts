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
  'home.allFinishedTitle': 'Say mbootaay jeex nañu',
  'home.allFinishedText':
    'Bokkal ci mbootaay bu bees ngir dellu ci natt. Say mbootaay yu jiitu ñu ngi ci « Mbootaay », say fey ci « Li weesu ».',

  // Choix de la langue (Profil)
  'language.title': 'Làkk',
  'language.hint': 'Tekki ci wolof bi mu ngi ñuy defar: yenn xët yi ci farañse lañu des.',

  // Guide de découverte de l'espace membre (bouton « ? » sur chaque page)
  'guide.help': 'Ndimbal: leeral xët wii',
  'guide.progress': '{current} ci {total}',
  'guide.next': 'Ci kanam',
  'guide.back': 'Dellu',
  'guide.skip': 'Bàyyi',
  'guide.done': 'Dégg naa',
  'guide.home.welcome.title': 'Dalal ak jàmm ci Calebasse',
  'guide.home.welcome.text':
    'Gindi bii dafay won la jëfekaay bi ci ay tànk yu néew. Bësal « ? » ci suufu xët wu nekk ngir gis leeralam.',
  'guide.home.due.title': 'Sa natt bi ci topp',
  'guide.home.due.text':
    'Xaalis bi nga wara fey ak bis bi mu wara jeex. Bësal « Fey léegi » ngir fey ak sa telefon.',
  'guide.home.groups.title': 'Say mbootaay',
  'guide.home.groups.text':
    'Fi nga tollu weer wii ci mbootaay bu nekk: fey na, wara fey walla yéex na. Bësal ci benn ngir gis ay wàllam.',
  'guide.home.turns.title': 'Sa wàll',
  'guide.home.turns.text': 'Kañ ngay jot xaalis bi, ak ñaata.',
  'guide.home.bell.title': 'Yégle yi',
  'guide.home.bell.text': 'Fii lay ñëw: fàttali yi, fey yi ñu nangu ak bataaxal yu sa njiit.',
  'guide.nav.title': 'Menu bi',
  'guide.nav.text':
    'Kër, Mbootaay, Fey, Li weesu ak Sama kont: benn bës rekk ngay soxla ngir dem ci bépp xët.',
  'guide.groups.list.title': 'Say mbootaay',
  'guide.groups.list.text': 'Mbootaay yépp yoo bokk. Bësal ci benn ngir gis lépp.',
  'guide.groups.open.title': 'Mbootaay yu ubbeeku',
  'guide.groups.open.text':
    'Mbootaay yu sa mboolo yoo mën a laaj ngir bokk. Njiit li moo koy nangu.',
  'guide.groups.join.title': 'Bokk ci mbootaay',
  'guide.groups.join.text': 'Jot nga ab lëkkalekaay walla kodu woote? Bësal fii ngir bind ko.',
  'guide.group.header.title': 'Sa mbootaay',
  'guide.group.header.text':
    'Natt bi, wàll bi ñu nekk ak fi nga tollu. Butoŋ « Fey » dafay feeñ bu amee natt boo wara fey.',
  'guide.group.facts.title': 'Sàrti mbootaay bi',
  'guide.group.facts.text':
    'Xaalis bi, ni muy doxe, bis bi mu wara jeex, alamaan bu yéex ak njiit yi.',
  'guide.group.calendar.title': 'Arminaatu wàll yi',
  'guide.group.calendar.text':
    'Kan moo jot xaalis bi ci wàll bu nekk. Ci wàll yu ñëwagul, mën nga laaj beneen waa mbootaay ngir weccoo.',
  'guide.group.members.title': 'Waa mbootaay bi',
  'guide.group.members.text': 'Ñi ngay natt ak ñoom ci mbootaay bii.',
  'guide.group.claim.title': 'Am na jafe-jafe?',
  'guide.group.claim.text':
    'Fey bu ñu gisul walla xaalis boo jotul: bindal sa jafe-jafe, ñu tontu la.',
  'guide.pay.steps.title': 'Fey ci 3 tànk',
  'guide.pay.steps.text': 'Tànnal natt bi, tànn ni ngay feye, ba noppi seet te nangu.',
  'guide.pay.content.title': 'Dara du fey te nanguwoo ko',
  'guide.pay.content.text': 'Xaalis bi, njëgu fey bi ak mbooleem gi dañuy feeñ balaa ngay nangu.',
  'guide.history.totals.title': 'Say mbooleem',
  'guide.history.totals.text': 'Li nga natt ak li nga jot.',
  'guide.history.filters.title': 'Tànn',
  'guide.history.filters.text': 'Tànnal benn mbootaay walla ab diir ngir gis ab fey.',
  'guide.history.list.title': 'Say fey',
  'guide.history.list.text': 'Bësal ci benn ngir gis lépp ak reçu bi.',
  'guide.profile.account.title': 'Sa kont',
  'guide.profile.account.text': 'Soppil sa kodu PIN te wax nimero bi ngay jote xaalis bi.',
  'guide.profile.language.title': 'Làkk',
  'guide.profile.language.text': 'Tànnal farañse walla wolof.',
  'guide.profile.notifications.title': 'Yégle yi',
  'guide.profile.notifications.text': 'Tànnal fàttali yi nga bëgg a jot.',
  'guide.notifications.title': 'Say yégle',
  'guide.notifications.text':
    'Yu bees yi ñoo nekk ci kaw. « Tout marquer lu » dafay leen dénc boo leen gisee.',
};
