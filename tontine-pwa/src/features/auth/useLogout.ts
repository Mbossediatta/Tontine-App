import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/hooks/useAuth';
import { authService } from '@/services';

/**
 * Déconnexion : ferme la session, vide les données en cache (pour qu'un autre
 * compte ne les voie pas) et renvoie à l'écran de connexion.
 */
export function useLogout(): () => Promise<void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async () => {
    await authService.logout();
    queryClient.clear();
    useAuthStore.getState().setUser(null);
    navigate('/connexion', { replace: true });
  };
}
