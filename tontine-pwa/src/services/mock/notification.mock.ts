import type { NotificationPreferences } from '@/types';
import type { NotificationService } from '../notification.service';
import { currentUser, db, delay, persist } from './db';
import { synchronize } from './clock';

const DEFAULT_PREFERENCES: NotificationPreferences = {
  reminders: true,
  beneficiary: true,
  payments: true,
};

export const mockNotificationService: NotificationService = {
  async list() {
    await delay();
    synchronize();
    const user = currentUser();
    return db.notifications
      .filter((n) => n.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async markRead(notificationId) {
    await delay();
    const user = currentUser();
    const notification = db.notifications.find(
      (n) => n.id === notificationId && n.userId === user.id,
    );
    if (notification) notification.read = true;
    persist();
  },

  async markAllRead() {
    await delay();
    const user = currentUser();
    db.notifications.forEach((n) => {
      if (n.userId === user.id) n.read = true;
    });
    persist();
  },

  async savePushSubscription(subscription) {
    await delay();
    db.pushSubscriptions[currentUser().id] = subscription;
    persist();
  },

  async getPreferences() {
    await delay();
    return db.preferences[currentUser().id] ?? DEFAULT_PREFERENCES;
  },

  async updatePreferences(preferences) {
    await delay();
    db.preferences[currentUser().id] = preferences;
    persist();
    return preferences;
  },
};
