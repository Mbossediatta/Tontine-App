import { useEffect, useState } from 'react';
import { useAuthStore, useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { formatPhoneLocal, normalizePhone } from '@/lib/format';
import { useAction } from '@/lib/query';
import { isSenegalMobile } from '@/lib/validators';
import { authService } from '@/services';
import type { PayoutMethod } from '@/types';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';

const SERVICES: Array<{ id: PayoutMethod; name: string }> = [
  { id: 'wave', name: 'Wave' },
  { id: 'orange_money', name: 'Orange Money' },
];

/** Numéro et service sur lesquels l'administrateur me verse la cagnotte. */
export function PayoutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useCurrentUser();
  const [service, setService] = useState<PayoutMethod>(user.payoutMethod ?? 'wave');
  const [phone, setPhone] = useState(user.payoutPhone ?? user.phone);

  // À chaque ouverture : les valeurs enregistrées.
  useEffect(() => {
    if (open) {
      setService(user.payoutMethod ?? 'wave');
      setPhone(user.payoutPhone ?? user.phone);
    }
  }, [open, user]);

  const save = useAction({
    action: () => authService.updateProfile({ payoutMethod: service, payoutPhone: phone }),
    success: 'Numéro de réception enregistré',
    onSuccess: (updated) => {
      useAuthStore.getState().setUser(updated);
      onClose();
    },
  });
  const valid = isSenegalMobile(phone);

  return (
    <BottomSheet open={open} onClose={onClose} title="Recevoir la cagnotte">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <p className="text-[13px] leading-5 text-slate-600">
          Le jour de ton tour, l’administrateur t’envoie la cagnotte sur ce numéro.
        </p>
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-2 text-[13px] font-semibold text-slate-700">Service</legend>
          {SERVICES.map((s) => (
            <label
              key={s.id}
              className={cn(
                'flex min-h-[48px] cursor-pointer items-center justify-center rounded-lg border text-[15px] font-semibold transition-colors duration-150 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700',
                service === s.id ? 'border-blue-700 bg-blue-50 text-blue-800' : 'border-slate-300',
              )}
            >
              <input
                type="radio"
                name="service"
                className="sr-only"
                checked={service === s.id}
                onChange={() => setService(s.id)}
              />
              {s.name}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-slate-700">Numéro</span>
          <span className="flex min-h-[48px] overflow-hidden rounded-lg border border-slate-300 focus-within:border-blue-700 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700">
            <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-[15px] font-semibold">
              +221
            </span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={formatPhoneLocal(phone)}
              onChange={(e) => setPhone(normalizePhone(e.target.value).slice(0, 9))}
              aria-invalid={phone.length === 9 && !valid ? true : undefined}
              className="min-w-0 flex-1 px-3 text-[15px] tabular-nums focus:outline-none"
            />
          </span>
          {phone.length === 9 && !valid ? (
            <span role="alert" className="text-[13px] font-semibold text-danger">
              Un numéro mobile commence par 7.
            </span>
          ) : null}
        </label>
        <Button type="submit" block loading={save.isPending} disabled={!valid}>
          Enregistrer
        </Button>
      </form>
    </BottomSheet>
  );
}
