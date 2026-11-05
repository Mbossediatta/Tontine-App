import type { Dispatch, SetStateAction } from 'react';
import { useAction } from '@/lib/query';
import { settingsService } from '@/services';
import type { PlatformSettings } from '@/types';

/** Ce que reçoit chaque section de la page Paramètres. */
export interface SectionProps {
  settings: PlatformSettings;
  setSettings: Dispatch<SetStateAction<PlatformSettings | null>>;
}

/** Enregistre une section des paramètres (toast « Paramètres enregistrés »). */
export function useSaveSettings<K extends keyof PlatformSettings>(section: K) {
  return useAction<PlatformSettings[K]>({
    action: (values) => settingsService.update(section, values),
    success: 'Paramètres enregistrés',
  });
}

/**
 * Enregistre une section qui a une clé secrète (paiement). `newSecret` n'est
 * envoyé que si l'administrateur a saisi une nouvelle clé ; l'ancienne n'est jamais lue.
 */
export function useSaveSecretSettings<K extends 'payment'>(section: K) {
  return useAction<{ values: PlatformSettings[K]; newSecret: string }>({
    action: ({ values, newSecret }) =>
      settingsService.update(section, values, newSecret.trim() || undefined),
    success: 'Paramètres enregistrés',
  });
}

/** Met à jour un champ numérique d'une section (0 si la saisie n'est pas un nombre). */
export function numberUpdater(setSettings: SectionProps['setSettings']) {
  return <K extends keyof PlatformSettings>(
    section: K,
    key: keyof PlatformSettings[K],
    value: string,
  ) => {
    const numeric = Number(value);
    setSettings((current) =>
      current
        ? {
            ...current,
            [section]: { ...current[section], [key]: Number.isFinite(numeric) ? numeric : 0 },
          }
        : current,
    );
  };
}
