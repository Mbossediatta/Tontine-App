import { QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage, ServiceError } from './errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Les données déjà consultées restent affichées hors ligne.
        networkMode: 'offlineFirst',
        retry: (failureCount, error) =>
          !(error instanceof ServiceError && error.code !== 'offline') && failureCount < 2,
      },
      mutations: { networkMode: 'always' },
    },
  });
}

export const queryKeys = {
  myGroups: ['groups', 'mine'] as const,
  discoverableGroups: ['groups', 'discoverable'] as const,
  managedGroups: ['groups', 'managed'] as const,
  group: (id: string) => ['groups', 'detail', id] as const,
  invite: (code: string) => ['groups', 'invite', code] as const,
  members: (groupId: string) => ['members', groupId] as const,
  rounds: (groupId: string) => ['rounds', groupId] as const,
  roundPayments: (roundId: string) => ['payments', 'round', roundId] as const,
  myHistory: (groupId: string) => ['payments', 'mine', groupId] as const,
  myTransactions: ['payments', 'mine', 'all'] as const,
  receipt: (paymentId: string) => ['payments', 'receipt', paymentId] as const,
  swaps: (groupId: string) => ['swaps', groupId] as const,
  debts: (groupId: string) => ['debts', groupId] as const,
  notifications: ['notifications'] as const,
  myDisputes: ['disputes', 'mine'] as const,
  preferences: ['notifications', 'preferences'] as const,
  dashboard: ['admin', 'dashboard'] as const,
  superDashboard: ['admin', 'super-dashboard'] as const,
  admins: ['admin', 'admins'] as const,
  adminChoices: ['admin', 'admins', 'choices'] as const,
  communities: ['admin', 'communities'] as const,
  admin: (id: string) => ['admin', 'admins', id] as const,
  platformMembers: (query: string) => ['admin', 'members', query] as const,
  platformMember: (id: string) => ['admin', 'member', id] as const,
};

interface ActionOptions<TInput, TResult> {
  action: (input: TInput) => Promise<TResult>;
  success?: string | ((result: TResult) => string);
  onSuccess?: (result: TResult) => void;
}

/**
 * Mutation standard : toast de confirmation ou d'erreur, puis rafraîchissement
 * de toutes les données pour que chaque écran reflète le nouvel état.
 */
export function useAction<TInput = void, TResult = void>({
  action,
  success,
  onSuccess,
}: ActionOptions<TInput, TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      onSuccess?.(result);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
