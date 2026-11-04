import type { AppNotification, NotificationPreferences } from '@/types';

export interface NotificationService {
  list(): Promise<AppNotification[]>;
  markRead(notificationId: string): Promise<void>;
  markAllRead(): Promise<void>;
  savePushSubscription(subscription: PushSubscriptionJSON): Promise<void>;
  getPreferences(): Promise<NotificationPreferences>;
  updatePreferences(preferences: NotificationPreferences): Promise<NotificationPreferences>;
}
