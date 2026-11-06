import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PIN_LENGTH, PinPad } from '@/features/auth/components/PinPad';
import { errorMessage } from '@/lib/errors';
import { isWeakPin } from '@/lib/checks';
import { authService } from '@/services';
import { BottomSheet } from '../ui/BottomSheet';

type Stage = 'current' | 'next' | 'confirm';

const PROMPTS: Record<Stage, string> = {
  current: 'Ton code PIN actuel',
  next: 'Ton nouveau code PIN',
  confirm: 'Confirme le nouveau code',
};

/**
 * Changer son code PIN, en trois saisies : l'actuel (preuve que c'est bien toi),
 * le nouveau (pas trop simple), puis sa confirmation.
 */
export function ChangePinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('current');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [shakeKey, setShakeKey] = useState(0);
  const [saving, setSaving] = useState(false);

  // Chaque ouverture repart de zéro.
  useEffect(() => {
    if (open) {
      setStage('current');
      setCurrent('');
      setNext('');
      setPin('');
      setError(undefined);
    }
  }, [open]);

  const fail = (message: string, back: Stage) => {
    setError(message);
    setShakeKey((k) => k + 1);
    setPin('');
    setStage(back);
  };

  // Chaque étape se valide dès le 4e chiffre.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH || saving) return;
    if (stage === 'current') {
      setCurrent(pin);
      setPin('');
      setError(undefined);
      setStage('next');
    } else if (stage === 'next') {
      if (isWeakPin(pin))
        return fail('Ce code est trop simple (1234, 0000…). Choisis-en un autre.', 'next');
      setNext(pin);
      setPin('');
      setError(undefined);
      setStage('confirm');
    } else if (pin !== next) {
      fail('Les deux codes ne correspondent pas. Recommence.', 'next');
    } else {
      void save();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function save() {
    setSaving(true);
    try {
      await authService.changePin(current, next);
      toast.success('Code PIN modifié');
      onClose();
    } catch (err) {
      // PIN actuel faux (ou bloqué) : on redemande le PIN actuel.
      fail(errorMessage(err), 'current');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Changer mon code PIN">
      <div className="flex flex-col items-center gap-4 pb-2">
        <p className="text-[15px] font-semibold" aria-live="polite">
          {PROMPTS[stage]}
        </p>
        <PinPad
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (error && value.length > 0) setError(undefined);
          }}
          disabled={saving}
          shakeKey={shakeKey}
          invalid={Boolean(error) && pin.length === 0}
        />
        {error ? (
          <p role="alert" className="text-center text-[13px] font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </BottomSheet>
  );
}
