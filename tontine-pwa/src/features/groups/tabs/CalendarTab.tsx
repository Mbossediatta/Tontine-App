import { RoundTimeline } from '@/components/domain';
import { AsyncContent, EmptyState } from '@/components/ui';
import { useCurrentUser } from '@/hooks/useAuth';
import { useRounds } from '../queries';

export function CalendarTab({ groupId }: { groupId: string }) {
  const user = useCurrentUser();
  const query = useRounds(groupId);
  return (
    <AsyncContent query={query}>
      {(rounds) =>
        rounds.length === 0 ? (
          <EmptyState
            title="Calendrier pas encore fixé"
            description="Le calendrier apparaîtra au démarrage du cycle."
          />
        ) : (
          <RoundTimeline rounds={rounds} myUserId={user.id} />
        )
      }
    </AsyncContent>
  );
}
