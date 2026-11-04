import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { createQueryClient } from '@/lib/query';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* En bas de l'écran, au-dessus de la barre de navigation. */}
      <Toaster
        position="bottom-center"
        offset={{ bottom: 24 }}
        mobileOffset={{ bottom: 88 }}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'flex w-full items-center gap-3 rounded-control bg-blue-700 px-4 py-3 font-sans text-body font-bold text-white shadow-float',
            success: '!bg-green-700 !text-white',
            error: '!border-2 !border-danger/30 !bg-white !text-danger',
            info: '!bg-blue-700 !text-white',
            description: 'text-label font-normal',
          },
        }}
      />
    </QueryClientProvider>
  );
}
