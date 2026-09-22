/**
 * La marque : quatre repères d'angle délimitant un cadre, et un point
 * marqué au centre. C'est littéralement ce que fait l'app — désigner un
 * point précis dans une image — et c'est le même vocabulaire que les
 * repères de recadrage du lecteur.
 *
 * Dessinée à la main plutôt que tracée d'une image : nette à toute taille,
 * et elle hérite de la couleur du texte via `currentColor`.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
      // Angles francs : un repère de recadrage n'est pas arrondi.
      strokeLinecap="square"
    >
      <g stroke="currentColor" strokeWidth="2">
        <path d="M3 10V6h5" />
        <path d="M16 6h5v4" />
        <path d="M21 14v4h-5" />
        <path d="M8 18H3v-4" />
      </g>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}
