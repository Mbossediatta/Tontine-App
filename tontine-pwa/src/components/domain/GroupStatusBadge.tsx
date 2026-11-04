import { Badge } from '@/components/ui';
import type { GroupStatus } from '@/types';
import { GROUP_STATUS_LABELS, GROUP_STATUS_TONES } from './groupStatus';

/** Badge du statut d'un groupe (« En cours », « Suspendu »…). */
export function GroupStatusBadge({ status }: { status: GroupStatus }) {
  return <Badge tone={GROUP_STATUS_TONES[status]}>{GROUP_STATUS_LABELS[status]}</Badge>;
}
