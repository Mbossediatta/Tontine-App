interface LogoProps {
  size?: number;
  className?: string;
  /** Logo purement décoratif (le nom est déjà écrit à côté). */
  decorative?: boolean;
}

/** Calebasse de l’Espoir : seul composant autorisé à contenir des couleurs en dur. */
export function Logo({ size = 48, className = '', decorative = false }: LogoProps) {
  return (
    <svg
      width={size}
      height={(size * 150) / 200}
      viewBox="0 0 200 150"
      className={className}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'Calebasse de l’Espoir'}
      aria-hidden={decorative ? true : undefined}
    >
      <path d="M8 52 Q8 146 100 146 Q192 146 192 52 Z" fill="#1E5AA8" />
      <path
        d="M22 82 L38 96 L54 82 L70 96 L86 82 L102 96 L118 82 L134 96 L150 82 L166 96 L180 84"
        fill="none"
        stroke="#A8E6C1"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <g fill="#FFFFFF" opacity=".9">
        <path d="M60 110 l6 11 h-12z" />
        <path d="M84 115 l6 11 h-12z" />
        <path d="M108 115 l6 11 h-12z" />
        <path d="M132 110 l6 11 h-12z" />
      </g>
      <ellipse cx="100" cy="52" rx="92" ry="20" fill="#12407A" />
      <ellipse cx="100" cy="52" rx="82" ry="14" fill="#0B2E5A" />
      <ellipse cx="100" cy="54" rx="62" ry="9" fill="#A8E6C1" />
    </svg>
  );
}
