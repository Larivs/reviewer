// Côté navigateur uniquement. Aucune dépendance.

/**
 * Taille d'une tranche. Assez grande pour que le découpage ne coûte rien sur
 * un réseau local, assez petite pour passer sous le plafond de 100 Mo par
 * requête de certains tunnels, et pour qu'une coupure ne fasse perdre que
 * quelques secondes d'envoi.
 */
const CHUNK = 32 * 1024 * 1024;
/** Tentatives consécutives sans progrès avant d'abandonner. */
const MAX_RETRIES = 6;

export type UploadTarget = {
  folderId?: string | null;
  /** Vidéo dont ce fichier devient une nouvelle version. */
  versionOf?: string | null;
};

export type UploadedVideo = { id: string; name: string };

/**
 * Empreinte du fichier, 32 chiffres hexadécimaux. Elle nomme l'envoi côté
 * serveur : le même fichier redéposé au même endroit retrouve ce qui était
 * déjà arrivé. Hachage maison et non `crypto.subtle`, qui n'existe pas en
 * HTTP simple, donc pas sur l'adresse du réseau local. Il n'a rien à
 * protéger, il doit seulement distinguer deux fichiers d'un même compte.
 */
export function uploadKey(file: File, target: UploadTarget) {
  const text = [file.name, file.size, file.lastModified, target.folderId ?? "", target.versionOf ?? ""].join("|");
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i += 1) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]
    .map((n) => (n >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

class UploadError extends Error {}

type ChunkResult =
  | { kind: "more"; offset: number }
  | { kind: "done"; video: UploadedVideo };

/**
 * Une tranche. XMLHttpRequest et non fetch : c'est le seul moyen d'obtenir
 * la progression d'un envoi. Rejette une `UploadError` quand le serveur a
 * refusé pour de bon, une `Error` simple quand ça vaut la peine de réessayer.
 */
function sendChunk(
  url: string,
  chunk: Blob,
  onLoaded: (bytes: number) => void,
  register: (abort: () => void) => void,
) {
  return new Promise<ChunkResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    register(() => xhr.abort());

    xhr.upload.onprogress = (event) => onLoaded(event.loaded);
    xhr.onload = () => {
      let payload: { error?: string; offset?: number; video?: UploadedVideo } = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        // Réponse non JSON : traitée plus bas d'après le code seul.
      }
      if (xhr.status === 201 && payload.video) return resolve({ kind: "done", video: payload.video });
      // 409 : le serveur n'en est pas où on croyait, il dit où reprendre.
      if ((xhr.status === 200 || xhr.status === 409) && typeof payload.offset === "number")
        return resolve({ kind: "more", offset: payload.offset });
      if (xhr.status >= 500) return reject(new Error(payload.error ?? "Erreur du serveur."));
      reject(new UploadError(payload.error ?? `Échec (code ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Connexion interrompue."));
    xhr.onabort = () => reject(new UploadError("Envoi annulé."));
    xhr.send(chunk);
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envoie un fichier par tranches, en reprenant là où une coupure l'a laissé.
 *
 * Le fichier part en corps brut, écrit au fil de l'eau côté serveur. Une
 * tranche qui échoue est retentée après avoir redemandé au serveur ce qu'il
 * a réellement reçu, avec un délai qui double : une coupure de Wi-Fi de
 * vingt secondes ne coûte plus un rush entier.
 */
export async function uploadFile(
  file: File,
  target: UploadTarget,
  onProgress: (ratio: number) => void,
  /** Reçoit de quoi couper l'envoi en cours. */
  onStart: (abort: () => void) => void,
): Promise<UploadedVideo> {
  const key = uploadKey(file, target);
  const base = new URLSearchParams({ key, name: file.name, size: String(file.size) });
  if (target.folderId) base.set("folderId", target.folderId);
  if (target.versionOf) base.set("versionOf", target.versionOf);

  let aborted = false;
  let abortChunk = () => {};
  onStart(() => {
    aborted = true;
    abortChunk();
  });

  const serverOffset = async () => {
    const response = await fetch(`/api/upload?key=${key}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Serveur injoignable.");
    return ((await response.json()) as { offset: number }).offset;
  };

  if (file.size === 0) throw new UploadError("Fichier vide.");

  let offset = await serverOffset().catch(() => 0);
  // Le serveur en a plus que le fichier : ce n'est pas le même, on repart.
  if (offset > file.size) offset = 0;
  let failures = 0;

  for (;;) {
    if (aborted) throw new UploadError("Envoi annulé.");
    const from = offset;
    onProgress(from / file.size);

    try {
      const result = await sendChunk(
        `/api/upload?${base}&offset=${from}`,
        file.slice(from, Math.min(file.size, from + CHUNK)),
        (loaded) => onProgress(Math.min(1, (from + loaded) / file.size)),
        (abort) => {
          abortChunk = abort;
        },
      );
      if (result.kind === "done") {
        onProgress(1);
        return result.video;
      }
      // Pas de progrès alors que le serveur répond : on compte, pour ne pas
      // tourner sans fin sur un désaccord.
      failures = result.offset > from ? 0 : failures + 1;
      offset = result.offset;
    } catch (error) {
      if (error instanceof UploadError || aborted) throw error;
      failures += 1;
      if (failures > MAX_RETRIES) throw error;
      await wait(Math.min(30_000, 1000 * 2 ** (failures - 1)));
      // La tranche a pu arriver en partie : seul le serveur sait où il en est.
      offset = await serverOffset().catch(() => offset);
    }
    if (failures > MAX_RETRIES) throw new Error("L'envoi n'avance plus.");
  }
}
