import { ProgressBar } from '@/components/ui';

/**
 * Barre de progression des parts payées sur un tour ; dans un Denthie (une seule épargne par
 * membre), des membres à jour sur la période.
 */
export function RoundProgress({
  paid,
  total,
  denthie = false,
}: {
  paid: number;
  total: number;
  denthie?: boolean;
}) {
  return (
    <ProgressBar
      value={paid}
      max={total}
      label={
        denthie ? `Membres à jour : ${paid} sur ${total}` : `Parts payées : ${paid} sur ${total}`
      }
    />
  );
}
