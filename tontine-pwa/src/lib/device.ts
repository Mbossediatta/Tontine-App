/**
 * Ordinateur (souris ou pavé tactile) plutôt que téléphone ou tablette.
 * On regarde le pointeur et non la largeur : une fenêtre d'ordinateur rétrécie reste
 * un ordinateur, une tablette tactile se comporte comme un téléphone.
 *
 * Un ordinateur est souvent partagé (bureau, association) : l'application n'y retient
 * aucun compte. Un téléphone est personnel : le compte y est retenu pour le PIN.
 */
export function isComputer(): boolean {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false; // navigateur sans matchMedia : comportement téléphone, le plus courant
  }
}
