import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { OfflineBanner, UpdateBanner } from '@/components/layout/Banners';
import { FullPageLoader } from '@/features/auth/RequireAuth';
import { useAuthBootstrap } from '@/hooks/useAuth';
import { AppProviders } from './providers';
import { router } from './router';

function AppContent() {
  useAuthBootstrap();
  return (
    <>
      <UpdateBanner />
      <OfflineBanner />
      <Suspense fallback={<FullPageLoader />}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </Suspense>
    </>
  );
}

export function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}
