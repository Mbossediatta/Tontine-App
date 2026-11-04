import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query';
import { adminService, groupService, memberService, paymentService } from '@/services';

export function useAdminDashboard() {
  return useQuery({ queryKey: queryKeys.dashboard, queryFn: () => adminService.dashboard() });
}

/** Vue globale de la plateforme (super administrateur uniquement). */
export function useSuperDashboard() {
  return useQuery({
    queryKey: queryKeys.superDashboard,
    queryFn: () => adminService.superDashboard(),
  });
}

export function useAdmins() {
  return useQuery({ queryKey: queryKeys.admins, queryFn: () => adminService.listAdmins() });
}

/** Admins actifs à qui confier un groupe (accessible aux administrateurs). */
export function useAdminChoices() {
  return useQuery({
    queryKey: queryKeys.adminChoices,
    queryFn: () => adminService.listAdminChoices(),
  });
}

export function useCommunities() {
  return useQuery({
    queryKey: queryKeys.communities,
    queryFn: () => adminService.listCommunities(),
  });
}

export function useRoundPayments(roundId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.roundPayments(roundId ?? ''),
    queryFn: () => paymentService.listForRound(roundId ?? ''),
    enabled: roundId !== undefined,
  });
}

export function useAdmin(userId: string) {
  return useQuery({
    queryKey: queryKeys.admin(userId),
    queryFn: () => adminService.getAdmin(userId),
  });
}

/** Tous les groupes (le super administrateur les gère tous). */
export function useAllGroups() {
  return useQuery({ queryKey: queryKeys.managedGroups, queryFn: () => groupService.listManaged() });
}

/** Membres de la plateforme ; la recherche est faite par le service (nom ou numéro). */
export function useMembers(query: string) {
  return useQuery({
    queryKey: queryKeys.platformMembers(query),
    queryFn: () => memberService.list(query),
    // Garde la liste affichée pendant qu'une nouvelle recherche se charge.
    placeholderData: (previous) => previous,
  });
}

export function useMemberProfile(userId: string) {
  return useQuery({
    queryKey: queryKeys.platformMember(userId),
    queryFn: () => memberService.get(userId),
  });
}
