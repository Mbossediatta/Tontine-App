import type { GroupOverview } from '@/types';

/**
 * Un admin qui gère ce groupe sans y cotiser peut y prendre une part lui-même, sans code :
 * avant le démarrage, s'il reste une place.
 */
export function canParticipate(overview: GroupOverview): boolean {
  return (
    overview.group.status === 'draft' &&
    overview.myMembershipStatus !== 'active' &&
    overview.activeShareCount < overview.group.maxMembers
  );
}
