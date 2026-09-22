type IconProps = { className?: string };

export function FolderIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.38a2 2 0 0 1 1.6.8l.84 1.12a1 1 0 0 0 .8.4h6.38A2.5 2.5 0 0 1 21 9.82V16.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M4 20h4L20 8l-4-4L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M5 7h14M10 4h4M6 7l1 13h10l1-13M10 11v5M14 11v5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M9 5l7 7-7 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Flèche qui entre dans un dossier : « ranger ailleurs ». Le dossier est
 * coupé par le bord droit, à 14 px un dossier entier plus une flèche
 * devient une tache, alors qu'un demi-dossier ouvert reste lisible.
 */
export function MoveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M13 5.5h1.9a1.5 1.5 0 0 1 1.2.6l.6.8a.8.8 0 0 0 .64.32h1.16A2.5 2.5 0 0 1 21 9.72V16A2.5 2.5 0 0 1 18.5 18.5H13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12h8m0 0-2.8-2.8M11 12l-2.8 2.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
