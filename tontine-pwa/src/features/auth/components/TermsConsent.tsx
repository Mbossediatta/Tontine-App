import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '@/components/ui';
import type { LegalTerms } from '@/types';

type Document = 'terms' | 'privacy';

const TITLES: Record<Document, string> = {
  terms: 'Conditions d’utilisation',
  privacy: 'Politique de confidentialité',
};

/** Lien vers l'un des textes : ouvre la fenêtre de lecture. */
function DocumentLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-semibold text-auth-primary underline underline-offset-2 hover:text-auth-primary-hover"
    >
      {children}
    </button>
  );
}

/**
 * Case « J'accepte les conditions d'utilisation et la politique de confidentialité ».
 * Jamais cochée d'avance ; chaque texte se lit dans une fenêtre sans quitter l'écran.
 */
export function TermsConsent({
  terms,
  checked,
  onChange,
  disabled = false,
}: {
  terms: LegalTerms | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [reading, setReading] = useState<Document | null>(null);
  const text = reading === 'terms' ? terms?.termsText : terms?.privacyText;

  return (
    <div className="flex items-start gap-3 rounded-[12px] border-2 border-auth-line bg-white p-4">
      {/* Case native (clavier, lecteurs d'écran) habillée en grande case de 24 px. */}
      <span className="relative mt-0.5 flex h-6 w-6 shrink-0">
        <input
          id={id}
          type="checkbox"
          aria-label="J’accepte les conditions d’utilisation et la politique de confidentialité"
          checked={checked}
          disabled={disabled || !terms}
          onChange={(event) => onChange(event.target.checked)}
          className="peer h-6 w-6 cursor-pointer appearance-none rounded-[6px] border-2 border-auth-line bg-white checked:border-auth-primary checked:bg-auth-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-auth-primary disabled:cursor-not-allowed disabled:opacity-60"
        />
        <Check
          className="pointer-events-none absolute inset-0 m-auto hidden h-4 w-4 text-white peer-checked:block"
          strokeWidth={3}
          aria-hidden="true"
        />
      </span>
      <p className="text-[14px] leading-[20px] text-auth-ink">
        <label htmlFor={id} className="cursor-pointer">
          J’ai lu et j’accepte les{' '}
        </label>
        <DocumentLink onClick={() => setReading('terms')}>conditions d’utilisation</DocumentLink>{' '}
        <label htmlFor={id} className="cursor-pointer">
          et la
        </label>{' '}
        <DocumentLink onClick={() => setReading('privacy')}>
          politique de confidentialité
        </DocumentLink>
        .
      </p>

      <Modal
        open={reading !== null}
        onClose={() => setReading(null)}
        title={reading ? TITLES[reading] : ''}
      >
        <p className="whitespace-pre-line text-ink">{text}</p>
        {terms ? <p className="mt-4 text-small text-muted">Version {terms.version}</p> : null}
      </Modal>
    </div>
  );
}
