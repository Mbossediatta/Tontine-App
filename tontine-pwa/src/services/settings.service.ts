import type { PlatformSettings } from '@/types';

/** Paramètres de la plateforme (super administrateur). */
export interface SettingsService {
  get(): Promise<PlatformSettings>;
  /** Enregistre une section des paramètres ; `section` sert au journal d'audit. */
  update<K extends keyof PlatformSettings>(section: K, values: PlatformSettings[K]): Promise<void>;
}
