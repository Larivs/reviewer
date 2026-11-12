import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { rename, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after } from "next/server";
import { getViewer, isStaff } from "@/lib/access";
import { getFolder } from "@/lib/folders";
import { makeSprite, makeThumbnail, playbackProblem, probe } from "@/lib/media";
import {
  displayName,
  insertVideo,
  MAX_UPLOAD_BYTES,
  safeExtension,
  spritePath,
  thumbnailPath,
  videoPath,
} from "@/lib/videos";

export const dynamic = "force-dynamic";
/** Le corps est écrit au fil de l'eau : jamais de fichier entier en mémoire. */
export const runtime = "nodejs";

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/**
 * Les planches d'aperçu se fabriquent une à la fois : chacune décode tout le
 * métrage, et dix envois à la suite lanceraient dix ffmpeg de front sur la
 * machine qui sert aussi la lecture aux autres.
 */
let spriteQueue: Promise<void> = Promise.resolve();

export async function POST(request: Request) {
  const user = await getViewer();
  if (!user) return fail("Session expirée.", 401);
  // Un invité commente, il ne dépose pas sur le disque de quelqu'un d'autre.
  if (!isStaff(user)) return fail("Ton compte n'a pas les droits pour déposer.", 403);

  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId") || null;
  const originalName = url.searchParams.get("name") ?? "";

  if (!originalName) return fail("Nom de fichier manquant.");
  if (folderId && !getFolder(folderId)) return fail("Ce dossier n'existe plus.");
  if (!request.body) return fail("Requête sans contenu.");

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return fail("Fichier trop volumineux (25 Go maximum).", 413);

  const id = randomUUID();
  const filename = `${id}.${safeExtension(originalName)}`;
  const final = videoPath(filename);
  // Écrit sous un nom provisoire, renommé une fois validé : si le serveur
  // s'arrête en plein envoi, ce qui reste sur le disque se reconnaît et
  // `npm run serve` le retire au démarrage, au lieu d'un fichier orphelin au
  // nom d'une vraie vidéo que plus rien ne référence.
  const target = `${final}.part`;

  let written = 0;
  try {
    // On recompte les octets reçus : un Content-Length menteur ne doit pas
    // pouvoir remplir le disque.
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        written += chunk.byteLength;
        if (written > MAX_UPLOAD_BYTES) throw new Error("TOO_LARGE");
        controller.enqueue(chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(request.body.pipeThrough(counter) as never),
      createWriteStream(target),
    );
  } catch (error) {
    await unlink(target).catch(() => {});
    if (error instanceof Error && error.message === "TOO_LARGE")
      return fail("Fichier trop volumineux (25 Go maximum).", 413);
    return fail("L'envoi a été interrompu.", 500);
  }

  if (written === 0) {
    await unlink(target).catch(() => {});
    return fail("Fichier vide.");
  }

  // Le contenu réel décide, pas l'extension : un .mp4 peut contenir du ProRes.
  let media;
  try {
    media = await probe(target);
  } catch {
    await unlink(target).catch(() => {});
    return fail("Fichier illisible : ce n'est pas une vidéo valide.");
  }

  const problem = playbackProblem(media);
  if (problem) {
    await unlink(target).catch(() => {});
    return fail(problem, 415);
  }

  // Ni la vignette ni la planche d'aperçu ne sont bloquantes : sans elles
  // la carte affiche un repère neutre et la piste n'a pas de survol.
  await makeThumbnail(target, thumbnailPath(id), media.duration).catch(() => {});

  let video;
  try {
    await rename(target, final);
    video = insertVideo({
      id,
      folderId,
      name: displayName(originalName),
      filename,
      size: written,
      duration: media.duration,
      fps: media.fps,
      status: "a_review",
      uploadedBy: user.id,
      createdAt: Date.now(),
    });
  } catch {
    // Le dossier a pu être supprimé pendant l'envoi : sans ligne en base,
    // rien ne doit rester sur le disque.
    await Promise.all(
      [target, final, thumbnailPath(id)].map((p) => unlink(p).catch(() => {})),
    );
    return fail("Ce dossier n'existe plus.");
  }

  // La planche vient après la réponse. Elle décode tout le métrage, plusieurs
  // minutes sur un long plan : l'attendre gardait la barre d'envoi à 100 %
  // sans rien dire, et bloquait le fichier suivant de la file. La piste
  // affiche le timecode seul en attendant, et recharge la planche ensuite.
  after(() => {
    spriteQueue = spriteQueue.then(() =>
      makeSprite(final, spritePath(id), media.duration).catch(() => {}),
    );
    return spriteQueue;
  });

  return Response.json({ video }, { status: 201 });
}
