"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import {
  deleteVideoAction,
  moveVideoAction,
  renameVideoAction,
} from "@/actions/videos";
import type { FolderOption } from "@/lib/folders";
import type { VideoListItem } from "@/lib/videos";
import { formatSize } from "@/lib/format";
import { formatClock } from "@/lib/timecode";
import { MoveIcon, PencilIcon, TrashIcon } from "./icons";
import { Logo } from "./logo";
import { HoldButton } from "./hold-button";
import { StatusPicker } from "./status-picker";

type Mode = "idle" | "renaming" | "confirming" | "moving";

/** Valeur du `select` de destination pour la racine, qui n'a pas d'id. */
const ROOT = "";

export function VideoCard({
  video,
  folders,
  canManage = true,
}: {
  video: VideoListItem;
  /** Destinations possibles, chemin complet compris. */
  folders: FolderOption[];
  /**
   * Renommer, déplacer, supprimer. Faux pour un invité : il commente la
   * vidéo d'un autre, il ne range pas sa bibliothèque. Les actions serveur
   * refusent de toute façon, ce drapeau évite juste de montrer trois
   * boutons qui répondraient « tu n'as pas les droits ».
   */
  canManage?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [thumbBroken, setThumbBroken] = useState(false);
  /**
   * Parcours au survol : glisser la souris sur la vignette fait défiler le
   * film, de gauche à droite. On reconnaît un montage à trois de ses plans
   * bien plus sûrement qu'à sa première image, et ça évite de l'ouvrir pour
   * vérifier que c'est le bon.
   *
   * Les images viennent de la planche d'aperçu que la piste utilise déjà.
   * Elle n'est demandée qu'au premier survol de **cette** vignette : une
   * grille de quarante vidéos ne télécharge pas quarante planches.
   */
  const thumbRef = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [sprite, setSprite] = useState<{ w: number; h: number } | "none" | null>(null);
  const spriteUrl = `/api/videos/${video.id}/sprite`;

  function onScrub(event: React.PointerEvent<HTMLDivElement>) {
    // À la souris seulement : au doigt, le geste appartient au défilement.
    if (event.pointerType !== "mouse" || video.state !== "ready") return;
    const box = thumbRef.current?.getBoundingClientRect();
    if (!box || event.clientY > box.bottom || event.clientY < box.top) return setScrub(null);

    if (sprite === null) {
      setSprite("none");
      const img = new Image();
      img.onload = () => setSprite({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = spriteUrl;
    }
    setScrub(Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width)));
  }

  const frames = sprite !== null && sprite !== "none" ? sprite : null;
  const scrubbing = scrub !== null && frames !== null;
  const tile = scrubbing ? Math.floor(scrub * 100) : 0;
  const [destination, setDestination] = useState(video.folderId ?? ROOT);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setMode("idle");
    setError(null);
    // La destination retombe sur l'emplacement réel : si on annule, le
    // sélecteur ne doit pas garder le choix abandonné à la réouverture.
    setDestination(video.folderId ?? ROOT);
  }

  function submitMove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      // Même raison que `chosen` plus bas : ne jamais envoyer un id de
      // dossier qui a disparu de la liste entre-temps.
      const cible =
        destination !== ROOT && !folders.some((f) => f.id === destination)
          ? ROOT
          : destination;
      const result = await moveVideoAction(
        video.id,
        cible === ROOT ? null : cible,
      );
      // Pas de `reset()` en cas de succès : la vidéo quitte la grille
      // courante, le composant est démonté par le rafraîchissement.
      if (!result.ok) setError(result.error);
    });
  }

  function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = inputRef.current?.value ?? "";
    startTransition(async () => {
      const result = await renameVideoAction(video.id, value);
      if (result.ok) reset();
      else setError(result.error);
    });
  }

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteVideoAction(video.id);
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
          defaultValue={video.name}
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

  if (mode === "moving") {
    const here = video.folderId ?? ROOT;
    /* La destination est un état, les options viennent des props. Si un
       autre poste supprime le dossier choisi, React réaligne l'affichage du
       `select` sur sa première option pendant que l'état garde l'id mort :
       on croyait envoyer à la racine, et l'action partait avec un dossier
       disparu pour se faire refuser par le serveur. La valeur dérivée
       supprime la divergence au lieu de la signaler. */
    const chosen =
      destination === ROOT || folders.some((f) => f.id === destination)
        ? destination
        : ROOT;

    return (
      <form
        data-busy
        onSubmit={submitMove}
        className="rounded-lg border border-accent-dim bg-surface p-3"
      >
        <span className="label">Déplacer</span>
        <p className="mt-1.5 truncate text-sm font-medium" title={video.name}>
          {video.name}
        </p>
        {/* `select` natif, comme le sélecteur de statut : clavier, tactile et
            liste système gratuits. Le dossier courant reste dans la liste,
            marqué « ici », le retirer ferait sauter les positions à chaque
            réouverture, on ne saurait plus d'où part le fichier. */}
        <select
          value={chosen}
          onChange={(e) => setDestination(e.target.value)}
          disabled={pending}
          aria-label="Dossier de destination"
          className="field mt-2 cursor-pointer"
          autoFocus
          onKeyDown={(e) => e.key === "Escape" && reset()}
        >
          <option value={ROOT}>
            Projets (racine){here === ROOT ? " (ici)" : ""}
          </option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.label}
              {folder.id === here ? " (ici)" : ""}
            </option>
          ))}
        </select>
        {error && (
          <p role="alert" className="mt-2 text-xs text-status-changes">
            {error}
          </p>
        )}
        <div className="mt-2.5 flex gap-2">
          <button
            type="submit"
            className="btn btn-primary !py-1"
            disabled={pending || chosen === here}
          >
            {pending ? "…" : "Déplacer"}
          </button>
          <button type="button" onClick={reset} className="btn btn-ghost !py-1">
            Annuler
          </button>
        </div>
      </form>
    );
  }

  if (mode === "confirming") {
    return (
      <div data-busy className="rounded-lg border border-status-changes/50 bg-surface p-3">
        <span className="label !text-status-changes">Supprimer</span>
        <p className="mt-1.5 truncate text-sm font-medium">{video.name}</p>
        <p className="mt-1 text-xs text-muted">
          {video.versionCount > 1
            ? `Les ${video.versionCount} versions et leurs commentaires partent avec. Action définitive.`
            : "Le fichier et ses commentaires partent avec. Action définitive."}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-status-changes">
            {error}
          </p>
        )}
        <div className="mt-2.5 flex gap-2">
          <HoldButton onConfirm={confirmDelete} disabled={pending}>
            {pending ? "…" : "Maintenir pour supprimer"}
          </HoldButton>
          <button type="button" onClick={reset} className="btn btn-ghost !py-1">
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onPointerMove={onScrub}
      onPointerLeave={() => setScrub(null)}
      className="group relative overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-line-strong"
    >
      {/* Le lien couvre la carte, aperçu compris. Il était en `z-0`, donc
          en dessous du conteneur de vignette qui le suit dans le DOM : un
          clic sur l'image, le geste le plus naturel, ne faisait rien, et
          seul le bandeau du bas ouvrait la vidéo. Les vrais contrôles
          (statut, renommer, supprimer) repassent au-dessus en `z-20`. */}
      <Link
        href={`/v/${video.id}`}
        className="absolute inset-0 z-10"
        aria-label={`Ouvrir ${video.name}`}
      />

      <div ref={thumbRef} className="relative aspect-video overflow-hidden bg-black">
        {thumbBroken ? (
          /* La marque en filigrane plutôt qu'une phrase seule au milieu du
             noir : c'est une amorce vierge, pas une erreur. Et le logo est
             exactement le sujet, quatre repères autour d'un point. */
          <div className="grid h-full place-content-center justify-items-center gap-2">
            <Logo className="size-7 text-line-strong" />
            <span className="label">Pas d&apos;aperçu</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/videos/${video.id}/thumbnail`}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            onError={() => setThumbBroken(true)}
          />
        )}

        {scrub !== null && frames !== null && (
          <>
            {/* L'image garde son rapport : une verticale reste verticale,
                centrée sur le noir, au lieu d'être étirée en 16:9. */}
            <span aria-hidden className="absolute inset-0 grid place-items-center bg-black">
              <span
                className="block max-h-full max-w-full"
                style={{
                  aspectRatio: `${frames.w} / ${frames.h}`,
                  ...(frames.w / frames.h >= 16 / 9 ? { width: "100%" } : { height: "100%" }),
                  backgroundImage: `url(${spriteUrl})`,
                  backgroundSize: "1000% 1000%",
                  backgroundPosition: `${((tile % 10) / 9) * 100}% ${(Math.floor(tile / 10) / 9) * 100}%`,
                }}
              />
            </span>
            {/* Où on en est dans le film : le même trait que la tête de
                lecture, pour qu'on comprenne le geste sans l'expliquer. */}
            <span
              aria-hidden
              className="neon absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent"
              style={{ left: `${scrub * 100}%` }}
            />
          </>
        )}

        {/* Une durée est un timecode : elle mérite l'afficheur de
            l'appareil, pas une pastille noire quelconque. Pendant le
            parcours, elle donne l'instant survolé. */}
        <span
          className={`tc-plate absolute bottom-1.5 right-1.5 !px-1.5 !py-0.5 text-[11px] ${
            scrubbing ? "text-accent" : "text-fg-dim"
          }`}
        >
          {formatClock(scrub !== null && frames !== null ? scrub * (video.duration ?? 0) : (video.duration ?? 0))}
        </span>

        {/* Le fichier n'est pas encore lisible, ou ne le sera pas : on le dit
            sur l'image, là où on s'attend à la voir. */}
        {video.state !== "ready" && (
          <span className="absolute inset-0 grid place-items-center bg-bg/75">
            <span className={`label ${video.state === "failed" ? "!text-status-changes" : "!text-accent"}`}>
              {video.state === "failed" ? "Conversion échouée" : "Conversion…"}
            </span>
          </span>
        )}

        {video.versionCount > 1 && (
          <span
            title={`${video.versionCount} versions, celle-ci est la dernière`}
            className="tc-plate absolute bottom-1.5 left-1.5 !px-1.5 !py-0.5 text-[11px] text-accent"
          >
            v{video.version}
          </span>
        )}

        {video.openComments > 0 && (
          <span
            title={`${video.openComments} note${video.openComments > 1 ? "s" : ""} en attente`}
            /* Le filet sombre n'est pas décoratif : la pastille est posée
               sur une image qu'on ne choisit pas. Sur une mire, l'accent
               plein tombait à touche-touche sur la barre rouge et le
               signal se noyait dans le motif. Le cerne la détache de
               n'importe quel fond sans lui retirer son aplat, et c'est
               l'aplat qui dit « ça demande attention ». */
            className="absolute left-1.5 top-1.5 rounded-sm bg-accent px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-accent-fg ring-1 ring-bg/70"
          >
            {video.openComments}
          </span>
        )}
      </div>

      {/* Filet entre l'image et son étiquette, là où l'œil passe de l'une
          à l'autre. */}
      <span aria-hidden className="block h-px bg-line" />

      <div className="p-2.5">
        <p className="truncate text-sm font-medium" title={video.name}>
          {video.name}
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="relative z-20">
            <StatusPicker videoId={video.id} status={video.status} />
          </span>
          <span className="label shrink-0">{formatSize(video.size)}</span>
        </div>
      </div>

      {canManage && (
      <div
        data-tour="video-actions"
        /* Visibles en permanence : un contrôle qui n'existe qu'au survol
           est un contrôle qu'on ne trouve pas. Ils restent en retrait au
           repos pour ne pas manger l'image, et passent au premier plan
           dès qu'on approche. */
        className="absolute right-1.5 top-1.5 z-20 flex gap-0.5 opacity-65 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      >
        <button
          type="button"
          onClick={() => setMode("renaming")}
          title="Renommer"
          aria-label={`Renommer ${video.name}`}
          className="rounded-sm border border-white/10 bg-black/70 p-1.5 text-white/75 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white"
        >
          <PencilIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setMode("moving")}
          title="Déplacer"
          aria-label={`Déplacer ${video.name}`}
          className="rounded-sm border border-white/10 bg-black/70 p-1.5 text-white/75 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white"
        >
          <MoveIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setMode("confirming")}
          title="Supprimer"
          aria-label={`Supprimer ${video.name}`}
          className="rounded-sm border border-white/10 bg-black/70 p-1.5 text-white/75 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-status-changes"
        >
          <TrashIcon className="size-3.5" />
        </button>
      </div>
      )}
    </div>
  );
}
