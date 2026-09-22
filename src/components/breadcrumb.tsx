import Link from "next/link";
import type { Folder } from "@/lib/folders";

/**
 * Uniquement les **ancêtres** du dossier courant, en petit et en retrait.
 * Le nom du dossier lui-même n'est plus ici : il est repris juste en
 * dessous comme titre de page, en capitales lourdes. Tant que les deux
 * étaient sur la même ligne et à la même taille, la page n'avait pas de
 * sommet, on lisait un fil, pas un titre.
 */
export function Breadcrumb({ trail }: { trail: Folder[] }) {
  const ancestors = trail.slice(0, -1);

  return (
    <nav
      aria-label="Fil d'Ariane"
      className="flex min-w-0 items-center gap-1.5 font-mono text-[11px]"
    >
      <Link
        href="/"
        className="shrink-0 uppercase tracking-[0.14em] text-muted transition-colors hover:text-fg"
      >
        Projets
      </Link>

      {ancestors.map((folder) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="shrink-0 text-line-strong">
            /
          </span>
          <Link
            href={`/f/${folder.id}`}
            className="truncate text-muted transition-colors hover:text-fg"
          >
            {folder.name}
          </Link>
        </span>
      ))}

      {trail.length > 0 && (
        <span aria-hidden className="shrink-0 text-line-strong">
          /
        </span>
      )}
    </nav>
  );
}
