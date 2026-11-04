import { WifiOff } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui';
import { useOnline } from '@/hooks/useOnline';

/** Bouton d'action qui exige une connexion : désactivé hors ligne avec « Connexion requise ». */
export function OnlineButton({ disabled, children, ...rest }: ButtonProps) {
  const online = useOnline();
  if (online) {
    return (
      <Button disabled={disabled} {...rest}>
        {children}
      </Button>
    );
  }
  return (
    <span className="flex w-full flex-col items-stretch gap-1 sm:w-auto">
      <Button disabled {...rest}>
        {children}
      </Button>
      <span className="flex items-center justify-center gap-1 text-label text-muted">
        <WifiOff className="h-4 w-4" aria-hidden="true" />
        Connexion requise
      </span>
    </span>
  );
}
