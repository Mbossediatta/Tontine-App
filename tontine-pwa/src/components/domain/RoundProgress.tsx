import { ProgressBar } from '@/components/ui';

/** Barre de progression des parts payées sur un tour. */
export function RoundProgress({ paid, total }: { paid: number; total: number }) {
  return (
    <ProgressBar
      value={paid}
      max={total}
      label={`Parts payées : ${paid} sur ${total}`}
    />
  );
}
