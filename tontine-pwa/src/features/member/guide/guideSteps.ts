import type { MessageKey } from '@/i18n';

/**
 * Étapes du guide de chaque page de l'espace membre. `target` : valeur de l'attribut
 * `data-guide` de la partie à éclairer ; sans `target`, la bulle s'affiche au centre.
 * Textes dans src/i18n (fr.ts et wo.ts, clés « guide.* »).
 */
export const GUIDES = {
  home: [
    { title: 'guide.home.welcome.title', text: 'guide.home.welcome.text' },
    { target: 'home-due', title: 'guide.home.due.title', text: 'guide.home.due.text' },
    { target: 'home-groups', title: 'guide.home.groups.title', text: 'guide.home.groups.text' },
    { target: 'home-turns', title: 'guide.home.turns.title', text: 'guide.home.turns.text' },
    { target: 'home-bell', title: 'guide.home.bell.title', text: 'guide.home.bell.text' },
    { target: 'nav', title: 'guide.nav.title', text: 'guide.nav.text' },
  ],
  groups: [
    { target: 'groups-list', title: 'guide.groups.list.title', text: 'guide.groups.list.text' },
    { target: 'groups-open', title: 'guide.groups.open.title', text: 'guide.groups.open.text' },
    { target: 'groups-join', title: 'guide.groups.join.title', text: 'guide.groups.join.text' },
  ],
  group: [
    { target: 'group-header', title: 'guide.group.header.title', text: 'guide.group.header.text' },
    { target: 'group-facts', title: 'guide.group.facts.title', text: 'guide.group.facts.text' },
    {
      target: 'group-calendar',
      title: 'guide.group.calendar.title',
      text: 'guide.group.calendar.text',
    },
    {
      target: 'group-members',
      title: 'guide.group.members.title',
      text: 'guide.group.members.text',
    },
    { target: 'group-claim', title: 'guide.group.claim.title', text: 'guide.group.claim.text' },
  ],
  pay: [
    { target: 'pay-steps', title: 'guide.pay.steps.title', text: 'guide.pay.steps.text' },
    { target: 'pay-content', title: 'guide.pay.content.title', text: 'guide.pay.content.text' },
  ],
  history: [
    {
      target: 'history-totals',
      title: 'guide.history.totals.title',
      text: 'guide.history.totals.text',
    },
    {
      target: 'history-filters',
      title: 'guide.history.filters.title',
      text: 'guide.history.filters.text',
    },
    { target: 'history-list', title: 'guide.history.list.title', text: 'guide.history.list.text' },
  ],
  profile: [
    {
      target: 'profile-account',
      title: 'guide.profile.account.title',
      text: 'guide.profile.account.text',
    },
    {
      target: 'profile-language',
      title: 'guide.profile.language.title',
      text: 'guide.profile.language.text',
    },
    {
      target: 'profile-notifications',
      title: 'guide.profile.notifications.title',
      text: 'guide.profile.notifications.text',
    },
  ],
  notifications: [
    {
      target: 'notifications-list',
      title: 'guide.notifications.title',
      text: 'guide.notifications.text',
    },
  ],
} satisfies Record<string, Array<{ target?: string; title: MessageKey; text: MessageKey }>>;

export type GuideId = keyof typeof GUIDES;
