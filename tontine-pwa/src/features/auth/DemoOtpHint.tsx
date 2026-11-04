import { useEffect, useState } from 'react';

/**
 * Mode démonstration uniquement : aucun SMS n'est envoyé, le code est donc affiché ici
 * (sur téléphone, la console du navigateur n'est pas accessible). Exclu du build de
 * production, comme les comptes de démonstration (voir OtpPage).
 */
export function DemoOtpHint({
  phone,
  sent,
  onUse,
}: {
  phone: string;
  /** Change à chaque nouvel envoi (« Renvoyer le code ») : on relit le dernier code. */
  sent: number;
  onUse: (code: string) => void;
}) {
  const [code, setCode] = useState<string>();
  useEffect(() => {
    let alive = true;
    void import('@/services/mock/otp').then(({ lastOtpFor }) => {
      if (alive) setCode(lastOtpFor(phone));
    });
    return () => {
      alive = false;
    };
  }, [phone, sent]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-[12px] bg-auth-page px-4 py-3 text-center text-[13px] leading-5 text-auth-muted">
      <p>Mode démonstration : aucun SMS n’est envoyé.</p>
      {code ? (
        <p className="flex flex-wrap items-center justify-center gap-2">
          Code de démo :
          <strong className="font-mono text-[17px] tracking-[0.2em] text-auth-ink">{code}</strong>
          <button
            type="button"
            onClick={() => onUse(code)}
            className="min-h-[36px] rounded-[10px] px-3 font-semibold text-auth-primary hover:bg-white"
          >
            Remplir
          </button>
        </p>
      ) : (
        <p>Aucun code en cours : appuyez sur « Renvoyer le code ».</p>
      )}
    </div>
  );
}
