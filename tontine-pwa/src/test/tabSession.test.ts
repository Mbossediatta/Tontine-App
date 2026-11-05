import { beforeEach, describe, expect, it } from 'vitest';
import { isTabSessionActive, setTabSessionActive } from '@/lib/tabSession';

describe('rechargement de la page', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('sans marque, un chargement est une nouvelle ouverture', () => {
    expect(isTabSessionActive()).toBe(false);
  });

  it('session ouverte dans cet onglet : le rechargement la reprend', () => {
    setTabSessionActive(true);
    expect(isTabSessionActive()).toBe(true);
  });

  it('verrouillage ou déconnexion : la marque disparaît', () => {
    setTabSessionActive(true);
    setTabSessionActive(false);
    expect(isTabSessionActive()).toBe(false);
  });
});
