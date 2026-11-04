// Pagination « Voir plus » des longues listes (membres, groupes, audit, historique…).
import { fireEvent, render, screen } from '@testing-library/react';
import { Paged } from '@/features/admin/components/Paged';

function List({ count, filter = '' }: { count: number; filter?: string }) {
  const items = Array.from({ length: count }, (_, index) => `Ligne ${index + 1}`);
  return (
    <Paged items={items} pageSize={20} resetKey={filter}>
      {(visible) => (
        <ul>
          {visible.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </Paged>
  );
}

describe('Voir plus', () => {
  it('affiche 20 lignes, puis 20 de plus à chaque appui, jusqu’à la fin', () => {
    render(<List count={45} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Voir plus (25 restants)' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: 'Voir plus (5 restants)' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(45);
    expect(screen.queryByRole('button', { name: /Voir plus/ })).not.toBeInTheDocument();
  });

  it('pas de bouton quand tout tient sur une page', () => {
    render(<List count={12} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /Voir plus/ })).not.toBeInTheDocument();
  });

  it('revient à la première page quand les filtres changent', () => {
    const { rerender } = render(<List count={45} />);
    fireEvent.click(screen.getByRole('button', { name: /Voir plus/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(40);
    rerender(<List count={45} filter="en retard" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
  });
});
