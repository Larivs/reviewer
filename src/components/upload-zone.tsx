"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSize } from "@/lib/format";

type ItemState = "attente" | "envoi" | "fini" | "erreur";

type Item = {
  key: string;
  name: string;
  size: number;
  progress: number;
  state: ItemState;
  error?: string;
};

/**
 * XMLHttpRequest et non fetch : c'est le seul moyen d'obtenir la progression
 * d'un envoi. Le fichier part en corps brut, écrit au fil de l'eau côté
 * serveur, pas de FormData, qui obligerait à tout charger en mémoire.
 */
function upload(file: File, folderId: string | null, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const params = new URLSearchParams({ name: file.name });
    if (folderId) params.set("folderId", folderId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload?${params}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Échec (code ${xhr.status})`;
      try {
        message = JSON.parse(xhr.responseText).error ?? message;
      } catch {
        // Réponse non JSON : on garde le message générique.
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Connexion interrompue."));
    xhr.onabort = () => reject(new Error("Envoi annulé."));

    xhr.send(file);
  });
}

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

  function patch(key: string, changes: Partial<Item>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const queued: Item[] = Array.from(files).map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      name: file.name,
      size: file.size,
      progress: 0,
      state: "attente",
    }));

    setItems((current) => [...current, ...queued]);
    setBusy(true);

    // Envoi séquentiel : deux gros fichiers en parallèle se partagent la même
    // bande passante et arrivent tous les deux plus tard.
    for (const [i, item] of queued.entries()) {
      patch(item.key, { state: "envoi" });
      try {
        await upload(files[i], folderId, (p) => patch(item.key, { progress: p }));
        patch(item.key, { state: "fini", progress: 1 });
      } catch (error) {
        patch(item.key, {
          state: "erreur",
          error: error instanceof Error ? error.message : "Échec de l'envoi.",
        });
      }
    }

    setBusy(false);
    router.refresh();
  }

  const done = items.filter((i) => i.state === "fini").length;
  const failed = items.filter((i) => i.state === "erreur");

  return (
    /* La zone prend la hauteur restante de la page : sur un dossier peu
       rempli, le bas de l'écran devient une cible de dépôt franche plutôt
       qu'un aplat noir avec un filet perdu au milieu. */
    <div className="mt-7 flex flex-1 flex-col">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        data-tour="upload"
        /* `data-busy` pendant un envoi : c'est le seul état de la page dont
           la perte serait réellement grave, une file de plusieurs gigaoctets
           et sa requête en vol. La réconciliation la préserve déjà, mais on
           ne re-rend pas la route pendant ce moment-là pour autant. */
        data-busy={busy || undefined}
        className={`flex min-h-32 flex-1 flex-col items-center justify-center rounded-lg border border-dashed px-5 py-6 text-center transition-colors ${
          dragging
            ? "border-accent bg-accent/[0.06]"
            : "border-line bg-surface/40 hover:border-line-strong hover:bg-surface/70"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*.mp4.mov.m4v.webm.mkv"
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
          Dépose des vidéos ici ou{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-55"
          >
            choisis des fichiers
          </button>
        </p>
        <p className="label mt-2">MP4 · H.264 / AAC. ProRes et DNxHD à réexporter</p>

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
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                  {item.state === "envoi" && `${Math.round(item.progress * 100)} %`}
                  {item.state === "attente" && "En attente"}
                  {item.state === "fini" && "Envoyée"}
                  {item.state === "erreur" && formatSize(item.size)}
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
