import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '@/hooks/useAuth';
import type { GlobalRole, GroupOverview, GroupRole, User } from '@/types';
import { RequireRole } from './RequireRole';

const groupState: { data?: Partial<GroupOverview>; isPending: boolean } = { isPending: false };

vi.mock('@/features/groups/queries', () => ({
  useGroup: () => groupState,
}));

function login(globalRole: GlobalRole) {
  const user: User = {
    id: 'u-1',
    firstName: 'Awa',
    lastName: 'Fall',
    phone: '771234567',
    globalRole,
    isSuspended: false,
  };
  useAuthStore.getState().setUser(user);
}

function setGroupRole(role: GroupRole | undefined, status: 'active' | 'pending' = 'active') {
  groupState.isPending = false;
  groupState.data = role ? { myRole: role, myMembershipStatus: status } : {};
}

function renderAt(path: string, element: ReactNode, pattern = '*') {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path={pattern} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

const secret = <p>Contenu protégé</p>;

describe('RequireRole', () => {
  beforeEach(() => setGroupRole(undefined));

  it('autorise un rôle global de la liste', () => {
    login('admin');
    renderAt('/admin', <RequireRole roles={['admin', 'super_admin']}>{secret}</RequireRole>);
    expect(screen.getByText('Contenu protégé')).toBeInTheDocument();
  });

  it('refuse un rôle global absent de la liste', () => {
    login('admin');
    renderAt('/admin/administrateurs', <RequireRole roles={['super_admin']}>{secret}</RequireRole>);
    expect(screen.getByText('Accès refusé')).toBeInTheDocument();
    expect(screen.queryByText('Contenu protégé')).not.toBeInTheDocument();
  });

  it('refuse un participant sur une page admin', () => {
    login('user');
    renderAt('/admin', <RequireRole roles={['admin', 'super_admin']}>{secret}</RequireRole>);
    expect(screen.getByText('Accès refusé')).toBeInTheDocument();
  });

  it('laisse tout passer au super administrateur', () => {
    login('super_admin');
    renderAt('/admin/administrateurs', <RequireRole roles={['admin']}>{secret}</RequireRole>);
    expect(screen.getByText('Contenu protégé')).toBeInTheDocument();
  });

  it('autorise un co-admin du groupe de l’URL', () => {
    login('user');
    setGroupRole('co_admin');
    renderAt(
      '/admin/groupes/g-1',
      <RequireRole groupRoles={['owner', 'co_admin']}>{secret}</RequireRole>,
      '/admin/groupes/:id',
    );
    expect(screen.getByText('Contenu protégé')).toBeInTheDocument();
  });

  it('refuse un simple membre sur la gestion du groupe', () => {
    login('admin');
    setGroupRole('member');
    renderAt(
      '/admin/groupes/g-1',
      <RequireRole groupRoles={['owner', 'co_admin']}>{secret}</RequireRole>,
      '/admin/groupes/:id',
    );
    expect(screen.getByText('Accès refusé')).toBeInTheDocument();
  });

  it('refuse une adhésion encore en attente', () => {
    login('user');
    setGroupRole('member', 'pending');
    renderAt(
      '/groupes/g-1',
      <RequireRole groupRoles={['member']}>{secret}</RequireRole>,
      '/groupes/:id',
    );
    expect(screen.getByText('Accès refusé')).toBeInTheDocument();
  });
});
