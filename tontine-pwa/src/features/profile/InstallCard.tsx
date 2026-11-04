import { Download, Share } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, CardTitle } from '@/components/ui';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

/** Bouton « Installer l'application » (Android) ou aide pour iPhone. */
export function InstallCard() {
  const { installed, canPrompt, showIosHelp, promptInstall } = useInstallPrompt();
  if (installed || (!canPrompt && !showIosHelp)) return null;

  const install = async () => {
    const accepted = await promptInstall();
    if (accepted) toast.success('Application installée');
  };

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Installer l’application</CardTitle>
      {showIosHelp ? (
        <p className="flex flex-wrap items-center gap-1 text-label text-ink">
          Touchez <Share className="h-4 w-4 text-blue-700" aria-label="Partager" /> « Partager »
          puis « Sur l’écran d’accueil ».
        </p>
      ) : (
        <>
          <p className="text-label text-muted">
            Ouvrez Calebasse de l’Espoir en un geste, même avec une connexion faible.
          </p>
          <Button
            block
            onClick={() => void install()}
            icon={<Download className="h-5 w-5" aria-hidden="true" />}
          >
            Installer l’application
          </Button>
        </>
      )}
    </Card>
  );
}
