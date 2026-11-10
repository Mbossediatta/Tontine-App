import { useQuery } from '@tanstack/react-query';
import { env } from '@/lib/env';
import { organizationService } from '@/services';

export const orgKeys = {
  all: ['organizations'] as const,
  list: ['organizations', 'list'] as const,
  collected: ['organizations', 'collected'] as const,
};

/** Organisations du super admin (chiffres globaux seulement). */
export function useOrganizations() {
  return useQuery({ queryKey: orgKeys.list, queryFn: () => organizationService.list() });
}

/** Total encaissé par organisation. */
export function useCollectedByOrganization() {
  return useQuery({
    queryKey: orgKeys.collected,
    queryFn: () => organizationService.collectedByOrganization(),
  });
}

/** Lien d'entrée dans l'appli de l'organisation (sa propre appli, pas Calebasse). */
export function organizationEntryLink(slug: string): string {
  return `${env.orgAppUrl.replace(/\/$/, '')}/o/${slug}`;
}
