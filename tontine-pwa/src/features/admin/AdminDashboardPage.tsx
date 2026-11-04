import { useAuth } from '@/hooks/useAuth';
import { AdminHome } from './home/AdminHome';
import { SuperAdminDashboard } from './super/SuperAdminDashboard';

/**
 * Page /admin : le super administrateur voit toute la plateforme,
 * un administrateur voit uniquement les groupes qu'il gère.
 */
export default function AdminDashboardPage() {
  const { isSuperAdmin } = useAuth();
  return isSuperAdmin ? <SuperAdminDashboard /> : <AdminHome />;
}
