import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { rename, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after } from "next/server";
import { getViewer, isStaff, type Viewer } from "@/lib/access";
import { getFolder } from "@/lib/folders";
import {
  audioToVideo,
  enqueueMediaJob,
  isAudioOnly,
  isStillImage,
  makeSprite,
  makeThumbnail,
  playbackProblem,
  probe,
  stillToVideo,
  transcode,
} from "@/lib/media";
import { notifyFolderChanged } from "@/lib/live";
import {
  displayName,
  getVideo,
  insertVersion,
  insertVideo,
  MAX_UPLOAD_BYTES,
  partPath,
  safeExtension,
  originalFilename,
  setVideoState,
  spritePath,
  thumbnailPath,
  videoPath,
  type Video,
} from "@/lib/videos";

export const dynamic = "force-dynamic";
/** Le corps est écrit au fil de l'eau : jamais de fichier entier en mémoire. */
export const runtime = "nodejs";

/** Le nom déposé, sans chemin et borné, pour le rendre au téléchargement. */
function displayFileName(name: string) {
  return name.replace(/^.*[\\/]/, "").slice(0, 200);
}

function fail(message: string, status = 400, extra: object = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

/**
 * L'empreinte vient du navigateur et finit dans un nom de fichier : on
 * n'accepte que la forme qu'il produit, 32 chiffres hexadécimaux.
 */
const KEY = /^[a-f0-9]{32}$/;

async function sizeOf(file: string) {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

async function staff(): Promise<Viewer | Response> {
  const user = await getViewer();
  if (!user) return fail("Session expirée.", 401);
  // Un invité commente, il ne dépose pas sur le disque de quelqu'un d'autre.
  if (!isStaff(user)) return fail("Ton compte n'a pas les droits pour déposer.", 403);
  return user;
}

/**
 * Où en est un envoi : le nombre d'octets déjà reçus pour cette empreinte.
 * C'est ce qui permet la reprise, le navigateur repart de là au lieu de zéro.
 */
export async function GET(request: Request) {
  const user = await staff();
  if (user instanceof Response) return user;

  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!KEY.test(key)) return fail("Empreinte invalide.");
  return Response.json({ offset: await sizeOf(partPath(user.id, key)) });
}

/**
 * Reçoit un **morceau** du fichier et l'ajoute à ce qui est déjà là.
 *
 * L'envoi partait en une seule requête : une coupure à 95 % d'un rush de
 * 20 Go obligeait à tout refaire. Le fichier arrive maintenant par tranches,
 * chacune ajoutée à un `.part` propre au compte et au fichier. Si une tranche
 * échoue, on redemande où on en est et on repart de là, y compris après
 * avoir fermé l'onglet : redéposer le même fichier reprend l'envoi.
 *
 * `offset` doit valoir exactement la taille déjà reçue. Sinon on répond 409
 * avec la vraie position plutôt que d'écrire au mauvais endroit, une tranche
 * interrompue laisse un bout partiel que le navigateur ne connaît pas.
 */
export async function POST(request: Request) {
  const user = await staff();
  if (user instanceof Response) return user;

  const params = new URL(request.url).searchParams;
  const key = params.get("key") ?? "";
  const originalName = params.get("name") ?? "";
  const folderId = params.get("folderId") || null;
  const versionOf = params.get("versionOf") || null;
  const total = Number(params.get("size"));
  const offset = Number(params.get("offset"));

  if (!KEY.test(key)) return fail("Empreinte invalide.");
  if (!originalName) return fail("Nom de fichier manquant.");
  if (!Number.isSafeInteger(total) || total <= 0) return fail("Fichier vide.");
  if (total > MAX_UPLOAD_BYTES) return fail("Fichier trop volumineux (25 Go maximum).", 413);
  if (!Number.isSafeInteger(offset) || offset < 0) return fail("Position invalide.");
  if (folderId && !getFolder(folderId)) return fail("Ce dossier n'existe plus.");
  if (!request.body) return fail("Requête sans contenu.");

  const base = versionOf ? getVideo(versionOf) : null;
  if (versionOf && !base) return fail("Cette vidéo n'existe plus.");

  const part = partPath(user.id, key);
  const have = await sizeOf(part);
  if (offset !== have) return fail("Reprise à une autre position.", 409, { offset: have });

  let written = 0;
  try {
    // On compte les octets reçus : une taille annoncée menteuse ne doit pas
    // pouvoir remplir le disque.
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        written += chunk.byteLength;
        if (have + written > total) throw new Error("TOO_LARGE");
        controller.enqueue(chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(request.body.pipeThrough(counter) as never),
      createWriteStream(part, { flags: "a" }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "TOO_LARGE") {
      await unlink(part).catch(() => {});
      return fail("Le fichier reçu dépasse la taille annoncée.", 413);
    }
    // Le `.part` reste : c'est justement lui qui permet de reprendre.
    return fail("L'envoi a été interrompu.", 500);
  }

  const received = have + written;
  if (received < total) return Response.json({ offset: received });

  return finalize({ part, size: received, originalName, folderId, base, user });
}

/** Le fichier est complet : on le valide, on l'enregistre, on lance la suite. */
async function finalize({
  part,
  size,
  originalName,
  folderId,
  base,
  user,
}: {
  part: string;
  size: number;
  originalName: string;
  folderId: string | null;
  base: Video | null;
  user: Viewer;
}) {
  // Le contenu réel décide, pas l'extension : un .mp4 peut contenir du ProRes.
  let media;
  try {
    media = await probe(part);
  } catch {
    await unlink(part).catch(() => {});
    return fail("Fichier illisible : ni une vidéo, ni une image, ni un son.");
  }
  if (!media.videoCodec && !media.audioCodec) {
    await unlink(part).catch(() => {});
    return fail("Ce fichier ne contient ni image ni son.", 415);
  }

  const kind = isStillImage(media) ? "image" : isAudioOnly(media) ? "audio" : "video";

  // Ce que le navigateur ne lit pas n'est plus refusé : on en fait un proxy
  // H.264. La vidéo existe tout de suite, marquée « en conversion ». Une
  // image ou un son passent toujours par là, voir `lib/media`.
  const needsTranscode = kind !== "video" || playbackProblem(media) !== null;
  const id = randomUUID();
  const filename = `${id}.${needsTranscode ? "mp4" : safeExtension(originalName)}`;
  const final = videoPath(filename);
  // L'original est gardé à côté de sa copie : c'est lui qu'on télécharge.
  const original = needsTranscode ? originalFilename(id, originalName) : null;
  const source = videoPath(original ?? filename);

  // Ni la vignette ni la planche d'aperçu ne sont bloquantes : sans elles
  // la carte affiche un repère neutre et la piste n'a pas de survol. Pour une
  // image ou un son, la vignette est tirée de la copie, une fois faite.
  if (kind === "video")
    await makeThumbnail(part, thumbnailPath(id), media.duration).catch(() => {});

  const row = {
    id,
    // Une nouvelle version vit là où vit la pile, et porte son nom.
    folderId: base ? base.folderId : folderId,
    name: base ? base.name : displayName(originalName),
    filename,
    size,
    // Une image dure la seconde de vidéo qu'on en fait.
    duration: kind === "image" ? 1 : media.duration,
    fps: kind === "video" ? media.fps : null,
    status: "a_review" as const,
    state: needsTranscode ? ("processing" as const) : ("ready" as const),
    kind: kind as "video" | "image" | "audio",
    original,
    originalName: displayFileName(originalName),
    uploadedBy: user.id,
    createdAt: Date.now(),
  };

  let video: Video;
  try {
    await rename(part, needsTranscode ? source : final);
    video = base ? insertVersion(base, row) : insertVideo({ ...row, stackId: null, version: 1 });
  } catch {
    // Le dossier a pu être supprimé pendant l'envoi : sans ligne en base,
    // rien ne doit rester sur le disque.
    await Promise.all(
      [part, final, source, thumbnailPath(id)].map((p) => unlink(p).catch(() => {})),
    );
    return fail("Ce dossier n'existe plus.");
  }

  // Conversion et planche viennent après la réponse, une à la fois. Les
  // attendre gardait la barre d'envoi figée à 100 % pendant des minutes.
  after(() =>
    enqueueMediaJob(async () => {
      if (needsTranscode) {
        const draft = `${final}.tmp`;
        try {
          if (kind === "image") await stillToVideo(source, draft);
          else if (kind === "audio") await audioToVideo(source, draft);
          else {
            await transcode(source, draft);
            // ffmpeg peut sortir en « succès » sur une source abîmée, avec
            // une copie qui s'arrête au milieu. On la découvrait à la
            // lecture : on compare les durées, et on refuse plus d'une
            // seconde ou 2 % d'écart.
            const made = (await probe(draft)).duration;
            if (media.duration !== null && made !== null) {
              const gap = Math.abs(media.duration - made);
              if (gap > Math.max(1, media.duration * 0.02)) throw new Error("TRONQUEE");
            }
          }
          await rename(draft, final);
          if (kind !== "video")
            await makeThumbnail(final, thumbnailPath(id), row.duration).catch(() => {});
          setVideoState(id, "ready", (await stat(final)).size);
        } catch {
          setVideoState(id, "failed");
          await unlink(draft).catch(() => {});
          return;
        } finally {
          notifyFolderChanged();
        }
      }
      await makeSprite(final, spritePath(id), row.duration);
    }),
  );

  return Response.json({ video }, { status: 201 });
}
