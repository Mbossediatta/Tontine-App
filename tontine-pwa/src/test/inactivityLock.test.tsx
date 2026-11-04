// Verrouillage automatique après une période d'inactivité (PIN redemandé).
import { act, renderHook } from '@testing-library/react';
import { useAuthStore } from '@/hooks/useAuth';
import { useInactivityLock } from '@/hooks/useInactivityLock';
import type { User } from '@/types';

const user: User = {
  id: 'u-test',
  firstName: 'Awa',
  lastName: 'Fall',
  phone: '772345678',
  globalRole: 'user',
  isSuspended: false,
};

describe('useInactivityLock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ user, status: 'authenticated', locked: false, lockAfterMinutes: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verrouille après le délai sans activité', () => {
    renderHook(() => useInactivityLock());
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(useAuthStore.getState().locked).toBe(true);
  });

  it('une activité repousse le verrouillage', () => {
    renderHook(() => useInactivityLock());
    act(() => {
      vi.advanceTimersByTime(45_000);
      window.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(45_000);
    });
    expect(useAuthStore.getState().locked).toBe(false);
  });
});
