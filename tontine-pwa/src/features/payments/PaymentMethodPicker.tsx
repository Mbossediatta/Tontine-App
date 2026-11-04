import { cn } from '@/lib/cn';
import type { InitiatePaymentInput } from '@/types';

export type OnlineMethod = InitiatePaymentInput['method'];

// Noms en texte seulement : pas de logos de marques tant que les autorisations ne sont pas obtenues.
const METHODS: Array<{ id: OnlineMethod; name: string }> = [
  { id: 'wave', name: 'Wave' },
  { id: 'orange_money', name: 'Orange Money' },
  { id: 'free_money', name: 'Free Money' },
];

interface PaymentMethodPickerProps {
  value: OnlineMethod | null;
  onChange: (method: OnlineMethod) => void;
}

/** Choix du moyen de paiement : trois cartes de 56 px avec bouton radio. */
export function PaymentMethodPicker({ value, onChange }: PaymentMethodPickerProps) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-label text-muted">Moyen de paiement</legend>
      {METHODS.map((method) => {
        const selected = value === method.id;
        return (
          <label
            key={method.id}
            className={cn(
              'flex h-14 cursor-pointer items-center justify-between gap-4 rounded-card border-2 px-4 transition-colors duration-150 focus-within:outline focus-within:outline-[3px] focus-within:outline-green-300',
              selected
                ? 'border-blue-700 bg-blue-100'
                : 'border-line bg-white hover:border-blue-700',
            )}
          >
            <span className="font-bold text-ink">{method.name}</span>
            <input
              type="radio"
              name="payment-method"
              value={method.id}
              checked={selected}
              onChange={() => onChange(method.id)}
              className="h-5 w-5 accent-blue-700"
            />
          </label>
        );
      })}
    </fieldset>
  );
}
