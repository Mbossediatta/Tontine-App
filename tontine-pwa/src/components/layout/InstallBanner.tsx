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
    // Bandeau d'application : × à gauche, icône, nom et explication, bouton « Installer ».
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center gap-3 bg-blue-700 px-3 py-2 text-white shadow-md"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <button
        type="button"
        onClick={close}
        aria-label="Fermer"
        className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-blue-100 hover:bg-white/15 hover:text-white"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <img
        src="/icons/icon-192.png"
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-[10px] bg-white shadow-sm"
      />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[15px] font-bold">Calebasse de l’Espoir</p>
        {showIosHelp ? (
          <p className="text-[12px] text-blue-100">
            Touchez <Share className="inline h-3.5 w-3.5 align-[-2px]" aria-label="Partager" /> puis
            « Sur l’écran d’accueil »
          </p>
        ) : (
          <p className="truncate text-[12px] text-blue-100">Installez l’application · gratuit</p>
        )}
      </div>
      {showIosHelp ? null : (
        <button
          type="button"
          onClick={() => void install()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] font-bold text-blue-700 shadow-sm transition-colors duration-150 hover:bg-blue-50"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Installer
        </button>
      )}
    </div>
  );
}
