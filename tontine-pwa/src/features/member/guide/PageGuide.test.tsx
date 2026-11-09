import { act, fireEvent, render, screen } from '@testing-library/react';
import { PageGuide } from './PageGuide';

/** jsdom ne calcule pas la mise en page : chaque partie marquée reçoit une taille. */
function giveSize() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    left: 16,
    width: 300,
    height: 80,
    bottom: 180,
    right: 316,
    x: 16,
    y: 100,
    toJSON: () => ({}),
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

function Page() {
  return (
    <div>
      <section data-guide="profile-account">Compte</section>
      <section data-guide="profile-language">Langue</section>
      {/* Pas de partie « profile-notifications » : son étape doit être sautée. */}
      <PageGuide id="profile" />
    </div>
  );
}

describe('guide de page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    giveSize();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('s’ouvre seul la première fois, avance avec « Suivant » et saute les parties absentes', () => {
    render(<Page />);
    act(() => vi.advanceTimersByTime(600));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('1 sur 2')).toBeInTheDocument();
    expect(screen.getByText('Ton compte')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(screen.getByText('2 sur 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Langue' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'C’est compris' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ne se rouvre pas seul, mais le bouton « ? » le relance à chaque fois', () => {
    const first = render(<Page />);
    act(() => vi.advanceTimersByTime(600));
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }));
    first.unmount();

    render(<Page />);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aide : expliquer cette page' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('1 sur 2')).toBeInTheDocument();
  });

  it('attend qu’une autre fenêtre soit fermée avant de s’ouvrir', () => {
    const other = document.createElement('div');
    other.setAttribute('aria-modal', 'true');
    document.body.appendChild(other);
    render(<Page />);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    other.remove();
    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
