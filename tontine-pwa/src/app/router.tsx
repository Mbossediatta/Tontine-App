import { lazy, type ReactNode } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { RequireRole } from '@/features/auth/RequireRole';
import { useCurrentUser } from '@/hooks/useAuth';
import { env } from '@/lib/env';

// Pages chargées à la demande (une par route).
const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const OtpPage = lazy(() => import('@/features/auth/OtpPage'));
const RegisterPage = lazy(() => import('@/features/auth/RegisterPage'));
const PinLoginPage = lazy(() => import('@/features/auth/PinLoginPage'));
const CreatePinPage = lazy(() => import('@/features/auth/CreatePinPage'));
const HomePage = lazy(() => import('@/features/groups/HomePage'));
const GroupsPage = lazy(() => import('@/features/groups/GroupsPage'));
const GroupDetailPage = lazy(() => import('@/features/groups/GroupDetailPage'));
const MemberHomePage = lazy(() => import('@/features/member/pages/MemberHomePage'));
const MemberGroupsPage = lazy(() => import('@/features/member/pages/MemberGroupsPage'));
const MemberGroupPage = lazy(() => import('@/features/member/pages/MemberGroupPage'));
const MemberNotificationsPage = lazy(
  () => import('@/features/member/pages/MemberNotificationsPage'),
);
const MemberProfilePage = lazy(() => import('@/features/member/pages/MemberProfilePage'));
const PayFlowPage = lazy(() => import('@/features/member/pages/PayFlowPage'));
const HistoryPage = lazy(() => import('@/features/member/pages/HistoryPage'));
const JoinPage = lazy(() => import('@/features/groups/JoinPage'));
const PayPage = lazy(() => import('@/features/payments/PayPage'));
const SimulationPage = lazy(() => import('@/features/payments/SimulationPage'));
const PaymentSuccessPage = lazy(() =>
  import('@/features/payments/PaymentResultPages').then((m) => ({ default: m.PaymentSuccessPage })),
);
const PaymentFailurePage = lazy(() =>
  import('@/features/payments/PaymentResultPages').then((m) => ({ default: m.PaymentFailurePage })),
);
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'));
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage'));
const AdminDashboardPage = lazy(() => import('@/features/admin/AdminDashboardPage'));
const CreateGroupPage = lazy(() => import('@/features/admin/create/CreateGroupPage'));
const AdminGroupsPage = lazy(() => import('@/features/admin/groups/AdminGroupsPage'));
const ManageGroupPage = lazy(() => import('@/features/admin/manage/ManageGroupPage'));
const AdminContributionsPage = lazy(() => import('@/features/admin/manage/AdminContributionsPage'));
const AdministratorsPage = lazy(() => import('@/features/admin/AdministratorsPage'));
const CommunitiesPage = lazy(() => import('@/features/admin/CommunitiesPage'));
const AdminDetailPage = lazy(() => import('@/features/admin/AdminDetailPage'));
const SuperGroupsPage = lazy(() => import('@/features/admin/groups/SuperGroupsPage'));
const MembersPage = lazy(() => import('@/features/admin/members/MembersPage'));
const MemberDetailPage = lazy(() => import('@/features/admin/members/MemberDetailPage'));
const TransactionsPage = lazy(() =>
  import('@/features/admin/platform/TransactionsPage').then((m) => ({
    default: m.TransactionsPage,
  })),
);
const PayoutsPage = lazy(() =>
  import('@/features/admin/platform/PayoutsPage').then((m) => ({ default: m.PayoutsPage })),
);
const DisputesPage = lazy(() =>
  import('@/features/admin/platform/DisputesPage').then((m) => ({ default: m.DisputesPage })),
);
const AnnouncementsPage = lazy(() =>
  import('@/features/admin/platform/AnnouncementsPage').then((m) => ({
    default: m.AnnouncementsPage,
  })),
);
const ReportsPage = lazy(() =>
  import('@/features/admin/platform/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const AuditPage = lazy(() =>
  import('@/features/admin/platform/AuditPage').then((m) => ({ default: m.AuditPage })),
);
const SettingsPage = lazy(() =>
  import('@/features/admin/platform/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const DemoUiPage = lazy(() => import('./DemoUiPage'));
const NotFoundPage = lazy(() => import('./NotFoundPage'));

function MemberPage({ member, other }: { member: ReactNode; other: ReactNode }) {
  const user = useCurrentUser();
  return user.globalRole === 'user' ? member : other;
}

const mockOnly: RouteObject[] = env.useMocks ? [{ path: '/demo-ui', element: <DemoUiPage /> }] : [];

const mockOnlyAuthenticated: RouteObject[] = env.useMocks
  ? [{ path: '/paiement/simulation', element: <SimulationPage /> }]
  : [];

export const routes: RouteObject[] = [
  { path: '/connexion', element: <LoginPage /> },
  { path: '/connexion/code', element: <OtpPage /> },
  { path: '/connexion/pin', element: <PinLoginPage /> },
  { path: '/connexion/pin/nouveau', element: <CreatePinPage /> },
  { path: '/inscription', element: <RegisterPage /> },
  ...mockOnly,
  {
    element: <RequireAuth />,
    children: [
      ...mockOnlyAuthenticated,
      { path: '/paiement/succes', element: <PaymentSuccessPage /> },
      { path: '/paiement/echec', element: <PaymentFailurePage /> },
      {
        element: <AppShell />,
        children: [
          {
            path: '/',
            element: <MemberPage member={<MemberHomePage />} other={<HomePage />} />,
          },
          {
            path: '/groupes',
            element: <MemberPage member={<MemberGroupsPage />} other={<GroupsPage />} />,
          },
          {
            path: '/groupes/:id',
            element: <RequireRole groupRoles={['owner', 'co_admin', 'member']} />,
            children: [
              {
                index: true,
                element: <MemberPage member={<MemberGroupPage />} other={<GroupDetailPage />} />,
              },
              { path: 'payer', element: <PayPage /> },
            ],
          },
          { path: '/payer', element: <PayFlowPage /> },
          { path: '/historique', element: <HistoryPage /> },
          { path: '/rejoindre/:code', element: <JoinPage /> },
          {
            path: '/notifications',
            element: (
              <MemberPage member={<MemberNotificationsPage />} other={<NotificationsPage />} />
            ),
          },
          {
            path: '/profil',
            element: <MemberPage member={<MemberProfilePage />} other={<ProfilePage />} />,
          },
          {
            element: <RequireRole roles={['admin', 'super_admin']} />,
            children: [
              { path: '/admin', element: <AdminDashboardPage /> },
              { path: '/admin/mes-groupes', element: <AdminGroupsPage /> },
              { path: '/admin/cotisations', element: <AdminContributionsPage /> },
              { path: '/admin/groupes/nouveau', element: <CreateGroupPage /> },
            ],
          },
          {
            path: '/admin/groupes/:id',
            element: <RequireRole groupRoles={['owner', 'co_admin']} />,
            children: [{ index: true, element: <ManageGroupPage /> }],
          },
          {
            // Back-office du super administrateur (12 rubriques ; « Mon compte » = /profil).
            element: <RequireRole roles={['super_admin']} />,
            children: [
              { path: '/admin/administrateurs', element: <AdministratorsPage /> },
              { path: '/admin/administrateurs/:id', element: <AdminDetailPage /> },
              { path: '/admin/communautes', element: <CommunitiesPage /> },
              { path: '/admin/groupes', element: <SuperGroupsPage /> },
              { path: '/admin/membres', element: <MembersPage /> },
              { path: '/admin/membres/:id', element: <MemberDetailPage /> },
              { path: '/admin/transactions', element: <TransactionsPage /> },
              { path: '/admin/versements', element: <PayoutsPage /> },
              { path: '/admin/litiges', element: <DisputesPage /> },
              { path: '/admin/annonces', element: <AnnouncementsPage /> },
              { path: '/admin/rapports', element: <ReportsPage /> },
              { path: '/admin/audit', element: <AuditPage /> },
              { path: '/admin/parametres', element: <SettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes, {
  future: {
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
});
