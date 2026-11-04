import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-blue-50 px-page">
      <EmptyState
        title="Page introuvable"
        description="Cette page n’existe pas ou a été déplacée."
        action={
          <Link
            to="/"
            className="inline-flex min-h-button w-full items-center justify-center rounded-control bg-blue-700 px-5 font-semibold text-white hover:bg-blue-900"
          >
            Retour à l’accueil
          </Link>
        }
      />
    </main>
  );
}
