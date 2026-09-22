"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import {
  countFolderContentsAction,
  deleteFolderAction,
  renameFolderAction,
} from "@/actions/folders";
import type { FolderListItem } from "@/lib/folders";
import { FolderIcon, PencilIcon, TrashIcon } from "./icons";

type Mode = "idle" | "renaming" | "confirming";

function pluralize(n: number, singular: string) {
  return `${n} ${singular}${n > 1 ? "s" : ""}`;
}

/** Contenu direct, comme un explorateur de fichiers. */
function contentsLabel({ folderCount, videoCount }: FolderListItem) {
  const parts: string[] = [];
  if (folderCount > 0) parts.push(pluralize(folderCount, "dossier"));
  if (videoCount > 0) parts.push(pluralize(videoCount, "vidéo"));
  return parts.length > 0 ? parts.join(" · ") : "Vide";
}

export function FolderCard({ folder }: { folder: FolderListItem }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [contents, setContents] = useState<{ folders: number; videos: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setMode("idle");
    setError(null);
    setContents(null);
  }

  /** Le décompte porte sur tout le sous-arbre, pas seulement les enfants. */
  function askDelete() {
    setMode("confirming");
    startTransition(async () => setContents(await countFolderContentsAction(folder.id)));
  }

  function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = inputRef.current?.value ?? "";
    startTransition(async () => {
      const result = await renameFolderAction(folder.id, value);
      if (result.ok) reset();
      else setError(result.error);
    });
  }

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteFolderAction(folder.id);
      if (!result.ok) setError(result.error);
    });
  }

  if (mode === "renaming") {
    return (
      /* `data-busy` : contrat lu par `live-grid`. Tant que cet attribut est
         présent quelque part dans la page, le sondage reporte son tour et ne
         re-rend pas la route. **Tout nouveau panneau de ce genre doit le
         porter**, sinon il se fera rafraîchir sous les doigts. */
      <form
        data-busy
        onSubmit={submitRename}
        className="rounded-lg border border-accent-dim bg-surface p-3"
      >
        <span className="label">Renommer</span>
        <input
          ref={inputRef}
          defaultValue={folder.name}
          className="field mt-1.5"
          autoFocus
          onKeyDown={(e) => e.key === "Escape" && reset()}
        />
        {error && (
          <p role="alert" className="mt-2 text-xs text-status-changes">
            {error}
          </p>
        )}
        <div className="mt-2.5 flex gap-2">
          <button type="submit" className="btn btn-primary !py-1" disabled={pending}>
            {pending ? "…" : "Renommer"}
          </button>
          <button type="button" onClick={reset} className="btn btn-ghost !py-1">
            Annuler
          </button>
        </div>
      </form>
    );
  }

  if (mode === "confirming") {
    const parts = contents
      ? [
          contents.folders > 0 ? pluralize(contents.folders, "sous-dossier") : null,
          contents.videos > 0 ? pluralize(contents.videos, "vidéo") : null,
        ].filter((part): part is string => part !== null)
      : null;

    return (
      /* Ici `data-busy` garde surtout l'encart COHÉRENT : le décompte du
         sous-arbre est un instantané pris à l'ouverture, alors que le nom
         vient des props et se mettrait à jour. Un nom frais accolé à un
         décompte périmé, sur l'action la plus destructrice de la page, c'est
         une incohérence invisible à l'œil. */
      <div data-busy className="rounded-lg border border-status-changes/50 bg-surface p-3">
        <span className="label !text-status-changes">Supprimer</span>
        <p className="mt-1.5 truncate text-sm font-medium">{folder.name}</p>
        <p className="mt-1 text-xs text-muted">
          {parts === null
            ? "Calcul du contenu…"
            : parts.length > 0
              ? `Contenu supprimé avec : ${parts.join(", ")}. Action définitive.`
              : "Cette action est définitive."}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-status-changes">
            {error}
          </p>
        )}
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={confirmDelete}
            disabled={pending}
            className="btn !bg-status-changes !py-1 text-white disabled:opacity-45"
          >
            {pending ? "…" : "Supprimer"}
          </button>
          <button type="button" onClick={reset} className="btn btn-ghost !py-1">
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-line-strong hover:bg-surface-2">
      {/* Filet de flanc : il tient le même rôle que l'ancien bord perforé, empêcher que le grand vide à droite du nom devienne le sujet de
          la carte, sans la référence à la boîte de bobine. Il s'allume à
          l'accent au survol, ce qui donne à la carte son seul mouvement. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-2 left-2 w-px bg-line-strong transition-colors group-hover:bg-accent"
      />
      {/* Le lien couvre la carte entière : les boutons d'action passent
          au-dessus, ce qui évite d'imbriquer des boutons dans un lien. */}
      <Link
        href={`/f/${folder.id}`}
        className="absolute inset-0 rounded-lg"
        aria-label={`Ouvrir ${folder.name}`}
      />

      {/* `pr-16` réserve la place des deux boutons : ils sont désormais
          toujours là, et un nom long passait dessous. */}
      <div className="flex items-center gap-3.5 py-4 pl-6 pr-16">
        {/* Plaque légèrement creusée, le même vocabulaire que l'afficheur du
            timecode : l'icône est posée sur un support et la carte a une
            matière, au lieu d'un pictogramme flottant sur le fond. */}
        <span className="grid size-10 shrink-0 place-items-center rounded-sm border border-line bg-surface-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] transition-colors group-hover:border-line-strong">
          <FolderIcon className="size-[18px] text-muted transition-colors group-hover:text-accent" />
        </span>
        <div className="min-w-0">
          {/* Capitales lourdes, comme le titre de la page et l'étiquette
              d'une boîte de bobine : un nom de dossier est un intitulé, pas
              une ligne de liste. */}
          <p
            className="heading heading-sm truncate text-[15px] text-fg"
            title={folder.name}
          >
            {folder.name}
          </p>
          <p className="label mt-1.5">{contentsLabel(folder)}</p>
        </div>
      </div>

      {/* Mêmes règles que sur la vignette vidéo : visibles au repos, en
          retrait tant qu'on ne s'en approche pas. */}
      <div className="absolute right-2 top-2 z-10 flex gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => setMode("renaming")}
          title="Renommer"
          aria-label={`Renommer ${folder.name}`}
          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
        >
          <PencilIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={askDelete}
          title="Supprimer"
          aria-label={`Supprimer ${folder.name}`}
          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-status-changes"
        >
          <TrashIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
