import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { readVideoOr404 } from "@/lib/access";
import { getVideo, videoPath } from "@/lib/videos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

type Resolved = { file: string; size: number; type: string };

async function resolve(id: string): Promise<Resolved | null> {
  const video = getVideo(id);
  if (!video) return null;

  const file = videoPath(video.filename);
  try {
    const info = await stat(file);
    return {
      file,
      size: info.size,
      type: MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    };
  } catch {
    // Ligne en base sans fichier : la base et le disque ont divergé.
    return null;
  }
}

/**
 * Lit un fichier (ou une tranche) dans un `ReadableStream` web.
 *
 * On n'utilise pas `Readable.toWeb` : quand le navigateur abandonne une requête
 * Range en cours, ce qu'il fait à chaque déplacement de la tête de lecture -
 * son adaptateur écrit dans un contrôleur déjà fermé et lève une
 * `uncaughtException` (`ERR_INVALID_STATE`) qui peut faire tomber le process.
 * Ici tout passe par le drapeau `done` : une fois posé, plus rien ne touche au
 * contrôleur et le descripteur de fichier est refermé.
 */
function fileStream(
  file: string,
  options: { start?: number; end?: number },
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const disk = createReadStream(file, options);
  let done = false;
  let onAbort = () => {};

  /** Point de sortie unique : détache tout et referme le descripteur. */
  const stop = () => {
    if (done) return false;
    done = true;
    signal.removeEventListener("abort", onAbort);
    // destroy() referme le descripteur (autoClose est actif par défaut).
    disk.destroy();
    return true;
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        onAbort = () => {
          // Le client a coupé : inutile de continuer à lire le disque.
          if (!stop()) return;
          try {
            controller.error(signal.reason);
          } catch {}
        };

        disk.on("data", (chunk) => {
          if (done) return;
          // Aucun encodage n'est posé sur le ReadStream : c'est toujours un Buffer.
          const bytes = chunk as Buffer;
          try {
            controller.enqueue(new Uint8Array(bytes));
          } catch {
            // Contrôleur déjà fermé côté consommateur : on s'arrête là.
            stop();
            return;
          }
          if ((controller.desiredSize ?? 1) <= 0) disk.pause();
        });

        disk.on("end", () => {
          if (!stop()) return;
          try {
            controller.close();
          } catch {}
        });

        disk.on("error", (error) => {
          if (!stop()) return;
          try {
            controller.error(error);
          } catch {}
        });

        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      },

      pull() {
        if (!done) disk.resume();
      },

      // Appelé par le serveur quand la réponse est abandonnée.
      cancel() {
        stop();
      },
    },
    { highWaterMark: 4 },
  );
}

/** `bytes=0-1023`, `bytes=500-` ou `bytes=-500` (derniers octets). */
function parseRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size)
    return null;

  return { start, end };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Le contrôle le plus important de l'app : c'est ici qu'on sert le fichier
  // lui-même. Une session valide ne suffit pas, il faut que la vidéo soit
  // dans la portée du compte.
  const access = await readVideoOr404(id);
  if (access instanceof Response) return access;

  const target = await resolve(id);
  if (!target) return new Response("Introuvable", { status: 404 });

  const { file, size, type } = target;
  const rangeHeader = request.headers.get("range");

  // Sans en-tête Range, on renvoie tout : c'est ce que fait un navigateur
  // au premier appel avant de découvrir Accept-Ranges.
  if (!rangeHeader) {
    return new Response(fileStream(file, {}, request.signal), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const range = parseRange(rangeHeader, size);
  if (!range)
    return new Response("Plage invalide", {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });

  const { start, end } = range;

  // 206 + Content-Range : c'est ce qui rend le déplacement dans la vidéo
  // instantané au lieu de retélécharger depuis le début.
  return new Response(fileStream(file, { start, end }, request.signal), {
    status: 206,
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function HEAD(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Même règle qu'en GET. Un HEAD révélerait la taille du fichier, donc
  // l'existence de la vidéo, à qui n'a pas à la connaître.
  const access = await readVideoOr404(id);
  if (access instanceof Response) return new Response(null, { status: access.status });

  const target = await resolve(id);
  if (!target) return new Response(null, { status: 404 });

  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": target.type,
      "Content-Length": String(target.size),
      "Accept-Ranges": "bytes",
    },
  });
}
