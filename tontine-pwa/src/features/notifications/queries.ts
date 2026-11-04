import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query';
import { notificationService } from '@/services';
import { useAuth } from '@/hooks/useAuth';

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => notificationService.list(),
    enabled: user !== null,
    refetchInterval: 30_000,
  });
}

export function useUnreadCount(): number {
  const { data } = useNotifications();
  return data?.filter((n) => !n.read).length ?? 0;
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.preferences,
    queryFn: () => notificationService.getPreferences(),
  });
}
