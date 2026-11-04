# DESIGN-UI.md – Calebasse de l’Espoir

> Fichier de référence visuelle pour l’agent qui code le frontend.
> Il **remplace la section 3 (Charte graphique)** du cahier des charges frontend.
> En cas de doute entre ce fichier et un autre, ce fichier gagne.

---

## 1. Règle d’or : trois couleurs seulement

L’identité repose sur **le vert, le bleu et le blanc**. Rien d’autre.

| Couleur | Part de l’écran | Rôle |
| --- | --- | --- |
| **Blanc** | environ 60 % | Fonds des pages, des cartes, des fenêtres |
| **Bleu** | environ 25 % | Structure : en-têtes, navigation, titres, liens, onglets actifs |
| **Vert** | environ 15 % | Argent et action : boutons principaux, Payer, montants reçus, statut « payé », succès |

Les seules exceptions autorisées :
- un gris-bleu foncé pour le texte et un gris-bleu clair pour les bordures (sinon le texte serait illisible) ;
- un orange et un rouge **uniquement** pour les badges « en attente » et « en retard » et les messages d’erreur, jamais en grande surface.

Interdits : dégradés multicolores, violet, jaune, noir pur, fonds colorés autres que bleu, vert très clair ou blanc.

---

## 2. Palette (tokens)

### Vert

| Token | Hex | Usage |
| --- | --- | --- |
| `green-50` | `#F1FBF5` | Fond très léger de section positive |
| `green-100` | `#E8F8EF` | Fond des badges « payé », encarts de succès |
| `green-300` | `#A8E6C1` | Vert clair de marque : illustrations, pièces, anneaux de focus, carte cagnotte |
| `green-600` | `#2E9E5B` | Icônes de succès, montants positifs, barres de progression |
| `green-700` | `#1F7A47` | **Fond des boutons principaux** (texte blanc lisible) |
| `green-800` | `#175E37` | Survol et appui des boutons verts |

### Bleu

| Token | Hex | Usage |
| --- | --- | --- |
| `blue-50` | `#F4F8FB` | Fond général de l’application (derrière les cartes) |
| `blue-100` | `#E3EEFA` | Fond des badges d’information, onglet actif, élément sélectionné |
| `blue-500` | `#3B7BD0` | Liens au survol, illustrations secondaires |
| `blue-700` | `#1E5AA8` | **Bleu de marque** : en-têtes, barre de navigation active, liens, boutons secondaires |
| `blue-900` | `#12407A` | Titres forts, texte sur fond vert clair, survol des éléments bleus |

### Blanc et neutres

| Token | Hex | Usage |
| --- | --- | --- |
| `white` | `#FFFFFF` | Fonds, cartes, texte sur bleu ou vert foncé |
| `ink` | `#1B2733` | Texte principal |
| `muted` | `#5B6B7A` | Texte secondaire, libellés, dates |
| `line` | `#DCE5EE` | Bordures, séparateurs |

### Statuts (usage limité)

| Token | Hex | Fond associé | Usage |
| --- | --- | --- | --- |
| `warning` | `#B86E0F` | `#FDF3E3` | Badge « en attente », date limite proche |
| `danger` | `#C53A3A` | `#FBEBEB` | Badge « en retard », erreurs de formulaire |

### Contrastes vérifiés

- Blanc sur `green-700` et sur `blue-700` : lisible (AA).
- `ink` sur `green-300`, `green-100`, `blue-100` : lisible (AA).
- **Ne jamais** mettre du texte blanc sur `green-300` ou `green-600` : pas assez de contraste.

---

## 3. Configuration Tailwind

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        green: {
          50: '#F1FBF5', 100: '#E8F8EF', 300: '#A8E6C1',
          600: '#2E9E5B', 700: '#1F7A47', 800: '#175E37',
        },
        blue: {
          50: '#F4F8FB', 100: '#E3EEFA', 500: '#3B7BD0',
          700: '#1E5AA8', 900: '#12407A',
        },
        ink: '#1B2733',
        muted: '#5B6B7A',
        line: '#DCE5EE',
        warning: { DEFAULT: '#B86E0F', bg: '#FDF3E3' },
        danger: { DEFAULT: '#C53A3A', bg: '#FBEBEB' },
      },
      fontFamily: {
        display: ['"Baloo 2"', 'system-ui', 'sans-serif'],
        sans: ['"Nunito Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '16px', control: '12px', pill: '999px' },
      boxShadow: {
        card: '0 4px 14px rgba(18, 64, 122, 0.08)',
        float: '0 12px 28px rgba(18, 64, 122, 0.16)',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

```css
/* src/styles/index.css */
@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito+Sans:wght@400;600;700;800&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html { -webkit-tap-highlight-color: transparent; }
  body { @apply bg-blue-50 text-ink font-sans antialiased; }
  h1, h2, h3 { @apply font-display text-blue-900; }
  :focus-visible { outline: 3px solid #A8E6C1; outline-offset: 2px; }
}
```

Les composants n’utilisent **que** ces classes de couleur. Aucune couleur en dur (`#...`) dans les fichiers `.tsx`, sauf dans le SVG du logo.

---

## 4. Typographie

| Style | Police | Taille / interligne | Graisse | Couleur |
| --- | --- | --- | --- | --- |
| Titre de page | Baloo 2 | 26 / 30 px | 800 | `blue-900` |
| Titre de section | Baloo 2 | 20 / 26 px | 700 | `blue-900` |
| Titre de carte | Nunito Sans | 17 / 24 px | 800 | `ink` |
| Texte | Nunito Sans | 16 / 24 px | 400 | `ink` |
| Libellé | Nunito Sans | 14 / 20 px | 600 | `muted` |
| Petit texte | Nunito Sans | 13 / 18 px | 600 | `muted` |
| Montant principal | Baloo 2 | 34 / 38 px | 800 | `blue-900` (à payer) ou `green-700` (reçu) |
| Montant secondaire | Nunito Sans | 17 px | 800 | `ink` |

Règles :
- Montants toujours avec `tabular-nums` et le format « 45 000 FCFA ».
- Phrases en minuscules (pas de texte tout en majuscules).
- Boutons : verbe d’action explicite (« Payer 4 500 FCFA », « Créer le groupe »).

---

## 5. Espacements, formes, ombres

- Grille de 4 px. Marges de page : 16 px sur mobile, 24 px au-delà de 640 px.
- Espace entre cartes : 12 px. Padding interne des cartes : 16 px.
- Coins : cartes 16 px, boutons et champs 12 px, badges et puces en pilule.
- Ombre `shadow-card` sur les cartes, `shadow-float` seulement sur les fenêtres et la barre de navigation.
- Largeur de contenu maximale : 560 px pour les écrans participant, 1100 px pour l’administration sur ordinateur.

---

## 6. Composants

Chaque composant vit dans `src/components/ui/` et accepte `className` pour les ajustements de mise en page.

### Button

| Variante | Classes |
| --- | --- |
| `primary` (action principale, Payer) | `bg-green-700 text-white hover:bg-green-800 active:bg-green-800` |
| `secondary` | `bg-white text-blue-700 border-2 border-blue-700 hover:bg-blue-100` |
| `blue` (navigation, admin) | `bg-blue-700 text-white hover:bg-blue-900` |
| `ghost` | `bg-transparent text-blue-700 hover:bg-blue-100` |
| `danger` | `bg-white text-danger border-2 border-danger/30 hover:bg-danger-bg` |

Base commune : `h-12 px-5 rounded-control font-bold text-base inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`. Sur mobile, le bouton d’action principal d’un écran prend toute la largeur. État de chargement : petit cercle qui tourne + texte « Paiement en cours… ».

### Input, PhoneInput, OtpInput, Select

- Champ : `h-12 w-full rounded-control border-2 border-line bg-white px-4 text-base text-ink placeholder:text-muted focus:border-blue-700 focus:outline-none`.
- Libellé au-dessus, en `text-sm font-semibold text-muted`, toujours présent.
- Erreur : bordure `border-danger`, message en dessous en `text-sm text-danger`.
- `PhoneInput` : préfixe fixe « +221 » dans une zone `bg-blue-50` à gauche.
- `OtpInput` : 6 cases de 48 × 56 px, case active bordée `border-blue-700`, case remplie `bg-green-50 border-green-300`.

### Card

`bg-white rounded-card shadow-card p-4`. Carte cliquable : ajouter `active:scale-[0.99] transition-transform`.

**Carte cagnotte** (élément vedette, une seule par écran) : `bg-green-300 text-ink rounded-card p-5`, montant en Baloo 2 34 px `text-blue-900`, petite illustration de calebasse à droite.

### Badge de statut

| Statut | Classes | Icône (lucide) |
| --- | --- | --- |
| Payé | `bg-green-100 text-green-700` | `Check` |
| En attente | `bg-warning-bg text-warning` | `Clock` |
| En retard | `bg-danger-bg text-danger` | `AlertCircle` |
| Ton tour | `bg-blue-100 text-blue-700` | `Star` |
| Admin | `bg-blue-700 text-white` | `Shield` |

Base : `inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-bold`. Toujours icône + texte, jamais la couleur seule.

### Tabs

Liste horizontale défilante. Onglet actif : `text-blue-700 border-b-[3px] border-blue-700 font-bold`. Inactif : `text-muted`.

### BottomNav (mobile)

`fixed bottom-0 inset-x-0 bg-white shadow-float border-t border-line`, hauteur 64 px + `env(safe-area-inset-bottom)`. 4 ou 5 onglets avec icône 24 px et libellé 12 px. Actif : icône et texte `text-blue-700`, pastille `bg-blue-100` derrière l’icône. Inactif : `text-muted`. Point de notification : rond `bg-green-600` de 8 px.

### SideNav (≥ 1024 px)

Colonne de 240 px `bg-blue-700 text-white`, logo en haut, lien actif `bg-white/15 rounded-control`.

### PageHeader

Fond `bg-blue-700`, texte blanc, hauteur 56 px, bouton retour à gauche, titre centré ou à gauche en Baloo 2 20 px. Sur l’accueil, l’en-tête est blanc avec « Bonjour, [prénom] » en `text-blue-900`.

### ProgressBar

Piste `bg-blue-100 h-2 rounded-pill`, remplissage `bg-green-600`. Libellé au-dessus : « 7 / 10 ont payé ».

### Avatar

Cercle avec initiales. Alterner `bg-blue-700 text-white` et `bg-green-300 text-ink` selon l’index du membre. Bordure blanche 3 px dans les listes superposées.

### Modal / ConfirmDialog

Fond `bg-ink/50`, panneau `bg-white rounded-t-card` qui monte du bas sur mobile, centré sur ordinateur. Bouton de confirmation : `primary` (vert) pour une action d’argent, `danger` pour une suppression.

### Toast

Bas de l’écran au-dessus de la BottomNav. Succès : `bg-green-700 text-white`. Erreur : `bg-white text-danger border-2 border-danger/30`. Info : `bg-blue-700 text-white`.

### EmptyState

Illustration de calebasse (logo en `opacity-90`), titre `text-blue-900`, phrase courte `text-muted`, un bouton `primary`.

### Skeleton

Blocs `bg-blue-100 animate-pulse rounded-control`.

### Composants métier

- `AmountText` : formate et colore le montant (`blue-900` à payer, `green-700` reçu).
- `PaymentMethodPicker` : 3 cartes de 56 px de haut (Wave, Orange Money, Free Money) avec le nom en texte et un bouton radio ; sélection `border-2 border-blue-700 bg-blue-100`. Pas de logos de marques tant que les autorisations ne sont pas obtenues.
- `GroupCard` : nom en titre de carte, ligne « 4 500 FCFA par mois », `ProgressBar` du cycle, badge de statut à droite.
- `StatCard` (admin) : chiffre en Baloo 2 28 px `text-blue-900`, libellé `text-muted`, icône dans un rond `bg-green-100 text-green-700`.

---

## 7. Mises en page des écrans clés

### Accueil participant

```
┌──────────────────────────────┐
│ Bonjour, Awa            🔔 2 │  en-tête blanc
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ À payer ce mois-ci       │ │  carte cagnotte vert clair
│ │ 9 000 FCFA        (calb.)│ │
│ │ Prochaine date : 5 déc.  │ │
│ └──────────────────────────┘ │
│ À payer                      │  titre de section bleu
│ ┌──────────────────────────┐ │
│ │ Tontine Famille  En att. │ │
│ │ 4 500 FCFA · avant 5 déc │ │
│ │ [ Payer 4 500 FCFA ]     │ │  bouton vert
│ └──────────────────────────┘ │
│ Mon prochain tour            │
│ ┌──────────────────────────┐ │
│ │ Mars – 45 000 FCFA  Ton t│ │  badge bleu clair
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ Accueil Groupes Notifs Profil│  BottomNav blanche, actif bleu
└──────────────────────────────┘
```

### Détail d’un groupe

```
┌──────────────────────────────┐
│ ←  Tontine Famille           │  en-tête bleu, texte blanc
│ 4 500 FCFA / mois            │
│ Cagnotte : 45 000 FCFA       │
├──────────────────────────────┤
│ Tour | Calendrier | Membres |…│  onglets, actif souligné bleu
├──────────────────────────────┤
│ Tour 3 sur 10                │
│ Bénéficiaire : Aïssatou      │
│ ███████░░░  7 / 10 ont payé  │  barre verte sur piste bleu clair
│ Votre statut : En attente    │
│ [   Payer 4 500 FCFA   ]     │  bouton vert pleine largeur
└──────────────────────────────┘
```

### Payer

```
┌──────────────────────────────┐
│ ←  Payer                     │
│        Votre cotisation      │
│         4 500 FCFA           │  Baloo 2, bleu foncé
│     [ Avant le 5 décembre ]  │  pilule orange claire
│ ┌──────────────────────── ◉ ┐│  Wave (sélectionné, bleu clair)
│ ┌──────────────────────── ○ ┐│  Orange Money
│ ┌──────────────────────── ○ ┐│  Free Money
│                              │
│ [   Payer 4 500 FCFA   ]     │  vert, collé en bas
└──────────────────────────────┘
```

### Tableau de bord administrateur

```
┌──────────────────────────────┐
│ Administration               │  en-tête bleu
├──────────────────────────────┤
│ ┌────────────┐┌────────────┐ │
│ │ 3 groupes  ││ 135 000 F  │ │  StatCards blanches
│ └────────────┘└────────────┘ │
│ ┌────────────┐┌────────────┐ │
│ │ 70 % payé  ││ 2 retards  │ │
│ └────────────┘└────────────┘ │
│ À traiter                    │
│  • 2 demandes d’adhésion   › │
│  • Tour 3 prêt à reverser  › │  ligne mise en avant vert clair
│ Mes groupes      [+ Créer]   │  bouton vert
│  GroupCard …                 │
└──────────────────────────────┘
```

Sur ordinateur, l’administration passe à une SideNav bleue à gauche et une grille de 4 StatCards sur une ligne.

---

## 8. Logo et icône

Logo : une calebasse bleue vue de profil, bord bleu foncé, gravures en zigzag vert clair et triangles blancs, remplie de pièces vert clair. Fichier `src/components/ui/Logo.tsx` :

```tsx
export function Logo({ size = 48, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={(size * 150) / 200} viewBox="0 0 200 150" className={className} role="img" aria-label="Calebasse de l’Espoir">
      <path d="M8 52 Q8 146 100 146 Q192 146 192 52 Z" fill="#1E5AA8" />
      <path d="M22 82 L38 96 L54 82 L70 96 L86 82 L102 96 L118 82 L134 96 L150 82 L166 96 L180 84" fill="none" stroke="#A8E6C1" strokeWidth="3.5" strokeLinejoin="round" />
      <g fill="#FFFFFF" opacity=".9">
        <path d="M60 110 l6 11 h-12z" /><path d="M84 115 l6 11 h-12z" />
        <path d="M108 115 l6 11 h-12z" /><path d="M132 110 l6 11 h-12z" />
      </g>
      <ellipse cx="100" cy="52" rx="92" ry="20" fill="#12407A" />
      <ellipse cx="100" cy="52" rx="82" ry="14" fill="#0B2E5A" />
      <ellipse cx="100" cy="54" rx="62" ry="9" fill="#A8E6C1" />
    </svg>
  );
}
```

Nom affiché : « Calebasse de l’Espoir » en Baloo 2 800, `text-blue-900` sur fond blanc, blanc sur fond bleu.

**Icônes PWA** (`public/icons/`) : fond blanc, cercle `green-300`, calebasse au centre ; tailles 192, 512 et 512 maskable (marge de sécurité de 20 %).

**Manifeste** : `theme_color: "#1E5AA8"`, `background_color: "#FFFFFF"`, `name: "Calebasse de l’Espoir"`, `short_name: "Calebasse"`.

---

## 9. Mouvement

- Durées : 150 ms (survol, appui), 250 ms (ouverture de fenêtre, changement d’onglet).
- Une seule animation marquante : la coche verte qui apparaît après un paiement confirmé (cercle `green-700` qui grandit avec un léger rebond, 400 ms).
- Respecter `prefers-reduced-motion` : désactiver les rebonds et transitions de position.

---

## 10. Accessibilité

- Zones tactiles d’au moins 44 × 44 px.
- Focus visible : anneau `green-300` de 3 px.
- Statuts toujours avec texte et icône.
- `aria-label` sur tous les boutons ne contenant qu’une icône.
- Taille de texte minimale 13 px.

---

## 11. Liste de contrôle pour l’agent

- [ ] `tailwind.config.ts` et `index.css` reprennent exactement les sections 3 et 4.
- [ ] Aucune couleur en dur dans les composants, sauf le logo.
- [ ] Les boutons d’action principaux sont verts (`green-700`), la structure est bleue (`blue-700`), les fonds sont blancs ou `blue-50`.
- [ ] Aucun texte blanc sur `green-300` ou `green-600`.
- [ ] Orange et rouge n’apparaissent que dans les badges de statut et les erreurs.
- [ ] Une page `/demo-ui` (mode mock) affiche tous les composants et toutes leurs variantes.
- [ ] Les écrans clés suivent les maquettes de la section 7.
