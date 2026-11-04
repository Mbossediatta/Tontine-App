import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ProgressBar } from './ProgressBar';

interface StepperProps {
  steps: ReadonlyArray<string>;
  /** Index de l'étape courante (0 pour la première). */
  current: number;
}

/** Barre de progression d'un assistant, avec la liste des étapes. */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <div className="flex flex-col gap-3">
      <ProgressBar
        value={current + 1}
        max={steps.length}
        label={`Étape ${current + 1} sur ${steps.length} : ${steps[current] ?? ''}`}
      />
      <ol className="flex flex-wrap gap-2">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-pill px-3 py-1 text-small font-bold',
                done && 'bg-green-100 text-green-700',
                active && 'bg-blue-700 text-white',
                !done && !active && 'bg-blue-50 text-muted',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              {step}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
