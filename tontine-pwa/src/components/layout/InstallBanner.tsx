import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { toast } from 'sonner';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

const DISMISS_KEY = 'calebasse.installBannerDismissed';
/** Après « Fermer », le bandeau revient au bout de 7 jours. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * Bandeau « Installer l'application », partout (connexion comprise) : bouton sur Android,
 * marche à suivre sur iPhone (Apple n'autorise pas de bouton). Caché une fois l'application
 * installée, et pendant 7 jours après « Fermer ».
 */
export function InstallBanner() {
  const { installed, canPrompt, showIosHelp, promptInstall } = useInstallPrompt();
  const [hidden, setHidden] = useState(dismissedRecently);
  if (installed || hidden || (!canPrompt && !showIosHelp)) return null;

  const close = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Stockage indisponible : fermé pour cette visite seulement.
    }
    setHidden(true);
  };
  const install = async () => {
    if (await promptInstall()) toast.success('Application installée');
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center gap-3 bg-green-700 px-4 py-2 text-label text-white"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      {showIosHelp ? (
        <p className="flex flex-1 flex-wrap items-center gap-1">
          Installez Calebasse : touchez <Share className="h-4 w-4" aria-label="Partager" /> «
          Partager » puis « Sur l’écran d’accueil ».
        </p>
      ) : (
        <>
          <p className="flex-1">
            Installez Calebasse sur votre téléphone : plus rapide, en un geste.
          </p>
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex min-h-touch shrink-0 items-center gap-1 rounded-control bg-white px-3 font-semibold text-green-800"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Installer
          </button>
        </>
      )}
      <button
        type="button"
        onClick={close}
        aria-label="Fermer"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control hover:bg-white/15"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
