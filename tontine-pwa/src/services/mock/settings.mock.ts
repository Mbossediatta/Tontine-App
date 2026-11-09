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

/** « •••• 3f9a » : assez pour reconnaître une clé, pas pour la reconstituer. */
function hint(secret: string): string | null {
  return secret ? `•••• ${secret.slice(-4)}` : null;
}

/** Sections dont une clé secrète peut être remplacée. */
const SECRET_SECTIONS: Partial<Record<keyof PlatformSettings, string>> = {
  payment: 'la clé secrète du service de paiement',
  sms: 'la clé du fournisseur SMS',
};

export const mockSettingsService: SettingsService = {
  async get() {
    await delay();
    assertSuperAdmin(currentUser());
    // Les clés restent côté serveur : la page ne reçoit que leur indice.
    const settings = cloneSettings(db.settings);
    settings.payment.secretKeyHint = hint(db.secrets.paymentSecretKey);
    settings.sms.apiKeyHint = hint(db.secrets.smsApiKey);
    return settings;
  },

  async update(section, values, newSecret) {
    const actor = await authorize();
    if (!values || typeof values !== 'object') {
      throw new ServiceError('Les paramètres transmis sont invalides.');
    }
    if (section === 'rules') {
      // Comme le serveur : la période de service coûte de 10 à 100 % d'une cotisation.
      const percent = Number((values as { platformSharePercent?: unknown }).platformSharePercent);
      if (!(percent >= 10 && percent <= 100)) {
        throw new ServiceError('Période de service : part d’une cotisation (%) : entre 10 et 100.');
      }
    }
    const before = db.settings.app;
    db.settings[section] = cloneSettings({ ...db.settings, [section]: values })[section];
    if (section === 'app') {
      // Comme le serveur : la version n'est pas saisie, elle augmente si un texte change.
      const changed =
        db.settings.app.termsText !== before.termsText ||
        db.settings.app.privacyText !== before.privacyText;
      db.settings.app.termsVersion = before.termsVersion + (changed ? 1 : 0);
    }
    const secret = newSecret?.trim();
    if (secret) {
      if (!SECRET_SECTIONS[section]) {
        throw new ServiceError('Cette section n’a pas de clé secrète.');
      }
      if (secret.length < 8) throw new ServiceError('Cette clé paraît trop courte.');
      if (section === 'payment') db.secrets.paymentSecretKey = secret;
      if (section === 'sms') db.secrets.smsApiKey = secret;
      recordAudit(actor, 'settings_updated', `a remplacé ${SECRET_SECTIONS[section]}`);
    }
    recordAudit(actor, 'settings_updated', `a modifié les paramètres « ${section} »`);
    persist();
  },
};
