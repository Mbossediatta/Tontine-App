import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';

export function AccessDeniedPage() {
  return (
    <div className="py-8">
      <EmptyState
        title="Accès refusé"
        description="Vous n’avez pas les droits nécessaires pour ouvrir cette page."
        action={
          <Link
            to="/"
            className="inline-flex min-h-button w-full items-center justify-center rounded-control bg-blue-700 px-5 font-semibold text-white hover:bg-blue-900"
          >
            Retour à l’accueil
          </Link>
        }
      />
    </div>
  );
}
