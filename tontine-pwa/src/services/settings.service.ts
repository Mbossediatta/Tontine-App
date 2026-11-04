import type { PlatformSettings } from '@/types';

/** Paramètres de la plateforme (super administrateur). */
export interface SettingsService {
  /** Les paramètres, sans les clés secrètes (seulement leur indice « •••• 3f9a »). */
  get(): Promise<PlatformSettings>;
  /**
   * Enregistre une section des paramètres ; `section` sert au journal d'audit.
   * `newSecret` remplace la clé secrète de la section (paiement ou SMS) : à ne passer
   * que si l'administrateur en a saisi une nouvelle. Les indices de `values` sont ignorés.
   */
  update<K extends keyof PlatformSettings>(
    section: K,
    values: PlatformSettings[K],
    newSecret?: string,
  ): Promise<void>;
}
