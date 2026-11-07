import { Suspense, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { OfflineBanner, UpdateBanner } from '@/components/layout/Banners';
import { InstallBanner } from '@/components/layout/InstallBanner';
import { FullPageLoader } from '@/features/auth/RequireAuth';
import { useAuthBootstrap, useAuthStore } from '@/hooks/useAuth';
import { AppProviders } from './providers';
import { router } from './router';
import { hideSplash } from './splash';

function AppContent() {
  useAuthBootstrap();
  // L'écran de démarrage part quand on sait qui est connecté : la première page
  // s'affiche alors sans clignoter (connexion, PIN ou accueil).
  const status = useAuthStore((state) => state.status);
  useEffect(() => {
    if (status !== 'loading') hideSplash();
  }, [status]);
  return (
    <>
      <UpdateBanner />
      <OfflineBanner />
      <InstallBanner />
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
