import { ServiceError } from '@/lib/errors';
import type { PlatformSettings, User } from '@/types';
import type { SettingsService } from '../settings.service';
import { assertSuperAdmin } from './access';
import { recordAudit } from './audit';
import { currentUser, db, delay, persist, requireOnline } from './db';

async function authorize(): Promise<User> {
  requireOnline();
  await delay();
  const actor = currentUser();
  assertSuperAdmin(actor);
  return actor;
}

function cloneSettings(settings: PlatformSettings): PlatformSettings {
  return JSON.parse(JSON.stringify(settings)) as PlatformSettings;
}

export const mockSettingsService: SettingsService = {
  async get() {
    await delay();
    assertSuperAdmin(currentUser());
    return cloneSettings(db.settings);
  },

  async update(section, values) {
    const actor = await authorize();
    if (!values || typeof values !== 'object') {
      throw new ServiceError('Les paramètres transmis sont invalides.');
    }
    db.settings[section] = cloneSettings({ ...db.settings, [section]: values })[section];
    recordAudit(actor, 'settings_updated', `a modifié les paramètres « ${section} »`);
    persist();
  },
};
