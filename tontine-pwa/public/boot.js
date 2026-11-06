// Démarrage, dans un fichier à part : la politique de sécurité du site (en-tête
// Content-Security-Policy, vercel.json) interdit le JavaScript écrit dans la page.

// Écran de démarrage : une fois par session (onglet). Ensuite (rechargement, retour
// de paiement), on le retire avant même qu'il soit dessiné. Voir src/app/splash.ts.
try {
  if (sessionStorage.getItem('calebasse.splashSeen.v1')) {
    var splash = document.getElementById('splash');
    if (splash) splash.remove();
  }
} catch (e) {
  /* Stockage indisponible : l'écran s'affiche normalement. */
}

// Polices chargées sans bloquer l'affichage : la feuille arrive en « print », puis
// s'applique dès qu'elle est prête (en attendant, les polices système s'affichent).
(function () {
  var fonts = document.getElementById('fonts');
  if (!fonts) return;
  var apply = function () {
    fonts.media = 'all';
  };
  if (fonts.sheet) apply();
  else fonts.addEventListener('load', apply);
})();
