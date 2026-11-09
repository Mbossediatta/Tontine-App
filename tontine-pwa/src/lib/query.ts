import { QueryClient, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { PERSIST_MAX_AGE } from './dataCache';
import { toast } from 'sonner';
import { errorMessage, ServiceError } from './errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Gardées en mémoire aussi longtemps que la copie sur le téléphone (lib/persistCache).
        gcTime: PERSIST_MAX_AGE,
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
  /**
   * Données à recharger après l'action (débuts de clés, voir queryKeys). Sans précision,
   * tout est rechargé : à réserver aux actions qui touchent plusieurs écrans (paiements,
   * tours, membres…). Une action limitée (notifications lues, préférences) le précise.
   */
  refresh?: readonly QueryKey[];
}

/** Données qui ne changent pas au fil des actions : jamais rechargées par useAction. */
const NOT_REFRESHED = new Set(['legal-terms', 'terms-status', 'simulation']);

/**
 * Mutation standard : toast de confirmation ou d'erreur, puis rafraîchissement des
 * données pour que chaque écran reflète le nouvel état.
 *
 * Le toast et la suite (fermeture d'une fenêtre, changement de page) viennent dès la
 * réponse du serveur, sans attendre le rechargement. L'action reste « en cours » jusqu'à
 * ce que les données soient à jour : un bouton ne peut pas être touché deux fois sur
 * un écran encore ancien.
 */
export function useAction<TInput = void, TResult = void>({
  action,
  success,
  onSuccess,
  refresh,
}: ActionOptions<TInput, TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async (result) => {
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      onSuccess?.(result);
      // Seuls les écrans affichés se rechargent ; les autres le feront à leur ouverture.
      await (refresh
        ? Promise.all(refresh.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
        : queryClient.invalidateQueries({
            predicate: (query) => !NOT_REFRESHED.has(String(query.queryKey[0])),
          }));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
