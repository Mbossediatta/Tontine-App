import { toCsv } from './csv';

describe('toCsv', () => {
  it('sépare les colonnes par des points-virgules et les lignes par CRLF', () => {
    expect(
      toCsv([
        ['Membre', 'Montant'],
        ['Awa Fall', 4500],
      ]),
    ).toBe('Membre;Montant\r\nAwa Fall;4500');
  });

  it('protège les cellules contenant un séparateur, un guillemet ou un retour à la ligne', () => {
    expect(toCsv([['a;b', 'il a dit "oui"', 'ligne 1\nligne 2']])).toBe(
      '"a;b";"il a dit ""oui""";"ligne 1\nligne 2"',
    );
  });

  it('garde les accents tels quels', () => {
    expect(toCsv([['Réussie', 'Échouée']])).toBe('Réussie;Échouée');
  });
});
