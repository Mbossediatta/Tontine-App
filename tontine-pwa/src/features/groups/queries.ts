import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query';
import {
  groupService,
  membershipService,
  paymentService,
  roundService,
  swapService,
} from '@/services';

export function useMyGroups() {
  return useQuery({ queryKey: queryKeys.myGroups, queryFn: () => groupService.listMine() });
}

export function useDiscoverableGroups() {
  return useQuery({
    queryKey: queryKeys.discoverableGroups,
    queryFn: () => groupService.listDiscoverable(),
  });
}

export function useGroup(groupId: string) {
  return useQuery({
    queryKey: queryKeys.group(groupId),
    queryFn: () => groupService.get(groupId),
  });
}

export function useMembers(groupId: string) {
  return useQuery({
    queryKey: queryKeys.members(groupId),
    queryFn: () => membershipService.list(groupId),
  });
}

export function useRounds(groupId: string) {
  return useQuery({
    queryKey: queryKeys.rounds(groupId),
    queryFn: () => roundService.list(groupId),
  });
}

export function useMyHistory(groupId: string) {
  return useQuery({
    queryKey: queryKeys.myHistory(groupId),
    queryFn: () => paymentService.listMine(groupId),
  });
}

export function useSwaps(groupId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.swaps(groupId),
    queryFn: () => swapService.list(groupId),
    enabled,
  });
}

export function useInvitePreview(code: string) {
  return useQuery({
    queryKey: queryKeys.invite(code),
    queryFn: () => groupService.getByInviteCode(code),
    retry: false,
  });
}
