import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui';
import { useCurrentUser } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/errors';
import { authService } from '@/services';
import { AuthError } from './components/AuthButton';
import { TermsConsent } from './components/TermsConsent';
import { useLogout } from './useLogout';

/**
 * Personne connectée qui n'a pas accepté la version en vigueur des conditions (textes
 * modifiés par le super admin depuis sa dernière acceptation) : fenêtre bloquante tant
 * qu'elle ne les a pas acceptées. Sinon, rien.
 */
export function TermsGate() {
  const queryClient = useQueryClient();
  const logout = useLogout();
  // Par compte : un changement de compte dans le même onglet relit son propre statut.
  const statusKey = ['terms-status', useCurrentUser()?.id];
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => authService.termsStatus(),
    staleTime: 5 * 60_000,
  });
  const due = status.data !== undefined && status.data.accepted !== status.data.current;
  const terms = useQuery({
    queryKey: ['legal-terms'],
    queryFn: () => authService.legalTerms(),
    enabled: due,
  });
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  if (!due) return null;

  const accept = async () => {
    if (!terms.data) return;
    setSaving(true);
    setError(undefined);
    try {
      await authService.acceptTerms(terms.data.version);
      await queryClient.invalidateQueries({ queryKey: statusKey });
    } catch (err) {
      setError(errorMessage(err));
      setChecked(false);
      await terms.refetch();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-t-card bg-white p-5 shadow-lg sm:rounded-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 id="terms-gate-title" className="font-display text-section text-blue-900">
            {status.data?.accepted === null
              ? 'Conditions d’utilisation'
              : 'Conditions mises à jour'}
          </h2>
        </div>
        <p className="text-muted">
          {status.data?.accepted === null
            ? 'Pour continuer, lisez et acceptez les conditions d’utilisation et la politique de confidentialité.'
            : 'Les conditions d’utilisation ou la politique de confidentialité ont changé. Lisez-les et acceptez-les pour continuer.'}
        </p>
        <TermsConsent terms={terms.data} checked={checked} onChange={setChecked} />
        <AuthError>{error}</AuthError>
        <Button variant="blue" disabled={!checked} loading={saving} onClick={() => void accept()}>
          Continuer
        </Button>
        <Button variant="outline" onClick={() => void logout()}>
          Se déconnecter
        </Button>
      </div>
    </div>
  );
}
