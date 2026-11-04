import type { ReactNode } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { PageSkeleton } from '@/components/ui';
import { useGroup } from '@/features/groups/queries';
import { useAuth } from '@/hooks/useAuth';
import type { GlobalRole, GroupRole } from '@/types';
import { AccessDeniedPage } from './AccessDeniedPage';

interface RequireRoleProps {
  /** Rôles globaux autorisés. */
  roles?: GlobalRole[];
  /** Rôles autorisés dans le groupe désigné par le paramètre `:id` de l'URL. */
  groupRoles?: GroupRole[];
  children?: ReactNode;
}

function GroupRoleGate({
  groupId,
  groupRoles,
  children,
}: {
  groupId: string;
  groupRoles: GroupRole[];
  children: ReactNode;
}) {
  const query = useGroup(groupId);
  if (query.isPending) return <PageSkeleton />;
  const overview = query.data;
  // Pages de gestion (rôles owner / co_admin demandés) : l'admin responsable du groupe
  // y a accès même s'il n'y cotise pas.
  const managerAllowed =
    overview?.canManage === true && groupRoles.some((role) => role !== 'member');
  const memberAllowed =
    overview?.myMembershipStatus === 'active' &&
    overview.myRole !== undefined &&
    groupRoles.includes(overview.myRole);
  const allowed = managerAllowed || memberAllowed;
  return allowed ? <>{children}</> : <AccessDeniedPage />;
}

/**
 * Autorise l'accès selon le rôle global, ou le rôle dans le groupe de l'URL.
 * Le super administrateur a accès à tout. Sinon : page « Accès refusé ».
 */
export function RequireRole({ roles, groupRoles, children }: RequireRoleProps) {
  const { user } = useAuth();
  const { id } = useParams();
  const content = <>{children ?? <Outlet />}</>;

  if (!user) return <AccessDeniedPage />;
  if (user.globalRole === 'super_admin') return content;
  if (roles?.includes(user.globalRole)) return content;
  if (groupRoles && id) {
    return (
      <GroupRoleGate groupId={id} groupRoles={groupRoles}>
        {content}
      </GroupRoleGate>
    );
  }
  return <AccessDeniedPage />;
}
