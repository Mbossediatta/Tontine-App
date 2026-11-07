import { fireEvent, render, screen } from '@testing-library/react';
import { InstallBanner } from './InstallBanner';

describe('bandeau d’installation', () => {
  const userAgent = navigator.userAgent;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent });
  });

  it('explique l’installation sur iPhone, puis se ferme pour 7 jours', () => {
    const { unmount } = render(<InstallBanner />);
    expect(screen.getByText(/Sur l’écran d’accueil/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByText(/Sur l’écran d’accueil/)).not.toBeInTheDocument();
    unmount();
    render(<InstallBanner />);
    expect(screen.queryByText(/Sur l’écran d’accueil/)).not.toBeInTheDocument();
  });
});
