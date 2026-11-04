import { useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { isIos, useInstallPrompt } from '@/hooks/useInstallPrompt';
import { usePushPermission } from '@/hooks/usePushPermission';

const DISMISS_KEY = 'tontine.pushPrompt.dismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Encart expliquant l'intérêt des notifications ; la permission n'est demandée qu'au clic.
 * Sur iPhone, le push exige que l'application soit installée sur l'écran d'accueil.
 */
export function PushPromptCard() {
  const { state, busy, subscribe } = usePushPermission();
  const { installed } = useInstallPrompt();
  const { isSuperAdmin } = useAuth();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed || state === 'granted' || state === 'denied') return null;
  const iosNotInstalled = isIos() && !installed;
  if (state === 'unsupported' && !iosNotInstalled) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Préférence non enregistrée : l'encart reviendra à la prochaine visite.
    }
  };

  const activate = async () => {
    const result = await subscribe();
    if (result === 'granted') toast.success('Notifications activées');
    else if (result === 'denied')
      toast.error('Notifications refusées. Modifiez-les dans les réglages du téléphone.');
  };

  return (
    <Card tone="info" className="relative flex gap-3 pr-12">
      <BellRing className="mt-1 h-6 w-6 shrink-0 text-blue-700" aria-hidden="true" />
      <div className="flex flex-col gap-2">
        {isSuperAdmin ? (
          // Le super administrateur ne cotise pas : on lui parle de ses alertes.
          <>
            <p className="font-semibold text-ink">Recevez les alertes de la plateforme</p>
            <p className="text-label text-ink">
              Soyez prévenu sur votre téléphone des paiements échoués, des retards et des demandes
              en attente.
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold text-ink">Recevez les rappels de cotisation</p>
            <p className="text-label text-ink">
              Soyez prévenu avant chaque date limite, quand c’est votre tour et quand un paiement
              est confirmé.
            </p>
          </>
        )}
        {iosNotInstalled ? (
          <p className="text-label text-muted">
            Sur iPhone, installez d’abord l’application : touchez « Partager » puis « Sur l’écran
            d’accueil ». Les notifications fonctionneront ensuite.
          </p>
        ) : (
          <Button size="sm" loading={busy} onClick={() => void activate()} className="self-start">
            Activer les notifications
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Masquer"
        className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-white"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </Card>
  );
}
