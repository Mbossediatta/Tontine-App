import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query';
import { paymentService } from '@/services';

/** Mes cotisations et cagnottes reçues, tous groupes confondus. */
export function useMyTransactions() {
  return useQuery({
    queryKey: queryKeys.myTransactions,
    queryFn: () => paymentService.myTransactions(),
  });
}
