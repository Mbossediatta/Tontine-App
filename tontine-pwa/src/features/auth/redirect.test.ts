import type { Location } from 'react-router-dom';
import type { GlobalRole, User } from '@/types';
import { redirectTarget } from './redirect';

const person = (globalRole: GlobalRole): User => ({
  id: 'u-1',
  firstName: 'Awa',
  lastName: 'Fall',
  phone: '771234567',
  globalRole,
  isSuspended: false,
});

const from = (path?: string) => ({ state: path ? { from: path } : null }) as Location;

describe('page ouverte après la connexion', () => {
  it('l’adresse du site seule ouvre l’accueil du rôle', () => {
    expect(redirectTarget(from('/'), person('super_admin'))).toBe('/admin');
    expect(redirectTarget(from('/'), person('admin'))).toBe('/admin');
    expect(redirectTarget(from('/'), person('user'))).toBe('/');
  });

  it('une page précise demandée avant la connexion est rouverte', () => {
    expect(redirectTarget(from('/groupes/g-1'), person('super_admin'))).toBe('/groupes/g-1');
    expect(redirectTarget(from('/rejoindre/ABC123'), person('user'))).toBe('/rejoindre/ABC123');
  });

  it('le profil (page de la déconnexion) n’est pas rouvert : accueil du rôle', () => {
    expect(redirectTarget(from('/profil'), person('user'))).toBe('/');
    expect(redirectTarget(from('/profil?onglet=securite'), person('user'))).toBe('/');
    expect(redirectTarget(from('/profil'), person('admin'))).toBe('/admin');
  });

  it('jamais vers un autre site', () => {
    expect(redirectTarget(from('//exemple.com'), person('user'))).toBe('/');
    expect(redirectTarget(from(), person('super_admin'))).toBe('/admin');
  });
});
