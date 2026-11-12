"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSize } from "@/lib/format";
import { uploadFile } from "@/lib/upload-client";
import { toast } from "./toast";

type ItemState = "attente" | "envoi" | "fini" | "erreur";

type Item = {
  key: string;
  name: string;
  size: number;
  progress: number;
  state: ItemState;
  error?: string;
};

export function UploadZone({
  folderId,
  empty = false,
  atRoot = false,
}: {
  folderId: string | null;
  /** Rien dans le dossier : la zone porte alors l'état vide de la page. */
  empty?: boolean;
  atRoot?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  /**
   * File unique. Un second dépôt pendant un envoi s'ajoute **derrière** le
   * premier : chaque dépôt lançait sa propre boucle, donc deux envois en
   * parallèle, et la première boucle à finir déclarait la zone libre alors
   * que l'autre envoyait encore.
   */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(0);
  const sent = useRef(0);
  const failedCount = useRef(0);
  const cancelled = useRef(new Set<string>());
  const abortCurrent = useRef<{ key: string; abort: () => void } | null>(null);

  // Fermer l'onglet pendant un envoi le perd en entier, il n'y a pas de
  // reprise : le navigateur demande confirmation.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  /**
   * Toute la page est une cible de dépôt. On lâche un fichier là où on
   * regarde, c'est-à-dire sur la grille, et il fallait viser un cadre en bas
   * de page. Un voile couvre l'écran dès qu'un fichier survole la fenêtre et
   * dit où il ira.
   *
   * `depth` compte les entrées et sorties : `dragleave` se déclenche à chaque
   * passage d'un élément à son voisin, et sans compteur le voile clignote.
   * On ne réagit qu'aux fichiers, pas à un texte ou un lien qu'on déplace.
   */
  const handleRef = useRef<(list: FileList | null) => void>(() => {});
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      // Sans ça le navigateur ouvre le fichier à la place de la page.
      if (hasFiles(event)) event.preventDefault();
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      handleRef.current(event.dataTransfer?.files ?? null);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  function patch(key: string, changes: Partial<Item>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );
  }

  function cancel(key: string) {
    cancelled.current.add(key);
    if (abortCurrent.current?.key === key) abortCurrent.current.abort();
    else patch(key, { state: "erreur", error: "Envoi annulé." });
  }

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;

    // Copie immédiate : la `FileList` d'un champ est vidée dès qu'on remet
    // sa valeur à zéro, bien avant que la file n'arrive à ces fichiers.
    const files = Array.from(list);
    const queued: Item[] = files.map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      name: file.name,
      size: file.size,
      progress: 0,
      state: "attente",
    }));

    setItems((current) => [...current, ...queued]);
    setBusy(true);
    waiting.current += 1;

    // Envoi séquentiel : deux gros fichiers en parallèle se partagent la même
    // bande passante et arrivent tous les deux plus tard.
    chain.current = chain.current.then(async () => {
      for (const [i, item] of queued.entries()) {
        if (cancelled.current.has(item.key)) continue;
        patch(item.key, { state: "envoi" });
        try {
          await uploadFile(
            files[i],
            { folderId },
            (p) => patch(item.key, { progress: p }),
            (abort) => {
              abortCurrent.current = { key: item.key, abort };
            },
          );
          patch(item.key, { state: "fini", progress: 1 });
        } catch (error) {
          failedCount.current += 1;
          patch(item.key, {
            state: "erreur",
            error: error instanceof Error ? error.message : "Échec de l'envoi.",
          });
        }
        abortCurrent.current = null;
      }

      waiting.current -= 1;
      // Un mot à la fin de chaque lot : on dépose, on part faire autre chose,
      // et la liste est souvent hors de l'écran quand l'envoi se termine.
      sent.current += queued.filter((item) => !cancelled.current.has(item.key)).length;
      if (waiting.current === 0) {
        const n = sent.current - failedCount.current;
        if (n > 0) toast(`${n} vidéo${n > 1 ? "s" : ""} envoyée${n > 1 ? "s" : ""}`);
        if (failedCount.current > 0)
          toast(`${failedCount.current} envoi${failedCount.current > 1 ? "s" : ""} en échec`, "error");
        sent.current = 0;
        failedCount.current = 0;
        setBusy(false);
        router.refresh();
      }
    });
  }

  handleRef.current = handleFiles;

  const done = items.filter((i) => i.state === "fini").length;
  const failed = items.filter((i) => i.state === "erreur");

  return (
    /* Dossier vide : la zone prend la hauteur restante et porte l'état vide.
       Dès qu'il y a du contenu, elle se réduit à une ligne : toute la page
       reçoit les fichiers, un grand cadre vide sous la grille ne servait plus
       qu'à occuper le regard. */
    <div className={`mt-7 flex flex-col ${empty ? "flex-1" : ""}`}>
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-bg/80 backdrop-blur-[2px]"
        >
          <div className="neon rounded-lg border border-accent bg-surface px-10 py-8 text-center">
            <p className="heading text-[22px]">Lâche pour envoyer</p>
            <p className="mt-1.5 text-sm text-muted">
              {atRoot ? "À la racine des projets" : "Dans ce dossier"}
            </p>
          </div>
        </div>
      )}

      <div
        data-tour="upload"
        /* `data-busy` pendant un envoi : c'est le seul état de la page dont
           la perte serait réellement grave, une file de plusieurs gigaoctets
           et sa requête en vol. La réconciliation la préserve déjà, mais on
           ne re-rend pas la route pendant ce moment-là pour autant. */
        data-busy={busy || undefined}
        className={`flex items-center justify-center rounded-lg border border-dashed border-line bg-surface/40 text-center transition-colors hover:border-line-strong hover:bg-surface/70 ${
          empty ? "min-h-32 flex-1 flex-col px-5 py-6" : "flex-wrap gap-x-4 gap-y-1 px-4 py-3"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*,image/*,audio/*,.mp4,.mov,.m4v,.webm,.mkv,.mxf"
          multiple
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {/* Quand la zone porte l'état vide, elle occupe la moitié de la
            page : sans rien, c'est un grand rectangle en pointillés autour
            de deux lignes de texte. L'amorce de bobine lui donne un haut et
            un bas, le même motif que l'en-tête et l'écran de connexion. */}
        {empty && (
          <>
            <span aria-hidden className="mb-5 h-px w-40 max-w-full bg-line" />
            <p className="heading mb-2 text-[19px] text-fg">
              {atRoot ? "Aucun projet" : "Dossier vide"}
            </p>
          </>
        )}

        <p className="text-sm text-muted">
          Dépose des fichiers n&apos;importe où sur la page, ou{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            choisis des fichiers
          </button>
        </p>
        <p className={`label ${empty ? "mt-2" : ""}`}>Vidéo, image ou son. ProRes, DNxHD et HEVC sont convertis à l'arrivée</p>

        {empty && (
          <span aria-hidden className="mt-5 h-px w-40 max-w-full bg-line" />
        )}
      </div>

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.key} className="rounded-lg border border-line bg-surface px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm">{item.name}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                  {item.state === "envoi" && `${Math.round(item.progress * 100)} %`}
                  {item.state === "attente" && "En attente"}
                  {item.state === "fini" && "Envoyée"}
                  {item.state === "erreur" && formatSize(item.size)}
                  {(item.state === "envoi" || item.state === "attente") && (
                    <button
                      type="button"
                      onClick={() => cancel(item.key)}
                      className="ml-3 underline-offset-2 hover:text-fg hover:underline"
                    >
                      Annuler
                    </button>
                  )}
                </span>
              </div>

              {(item.state === "envoi" || item.state === "attente") && (
                <div className="mt-2 h-[3px] overflow-hidden rounded-sm bg-surface-3">
                  <div
                    className="h-full rounded-sm bg-accent transition-[width] duration-150"
                    style={{ width: `${item.progress * 100}%` }}
                  />
                </div>
              )}

              {item.error && (
                <p role="alert" className="mt-1.5 text-xs text-status-changes">
                  {item.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!busy && items.length > 0 && (
        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <span>
            {done} envoyée{done > 1 ? "s" : ""}
            {failed.length > 0 && ` · ${failed.length} en échec`}
          </span>
          <button
            type="button"
            onClick={() => setItems([])}
            className="underline-offset-2 hover:text-fg hover:underline"
          >
            Effacer la liste
          </button>
        </div>
      )}
    </div>
  );
}
