import { getViewer, readVideoOr404 } from "@/lib/access";
import { watchLibrary, watchVideo, type Send } from "@/lib/live";
import { userColorIndex } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Sous ce délai sans rien envoyer, un proxy referme la connexion. */
const HEARTBEAT_MS = 25_000;

/**
 * Flux d'événements (Server-Sent Events).
 *
 * `?video=<id>` : les changements de cette vidéo et qui la regarde. Sans
 * paramètre : les changements de la bibliothèque. Dans les deux cas le flux
 * ne dit que « ça a changé », voir `lib/live`.
 *
 * SSE plutôt que WebSocket : le trafic ne va que du serveur au navigateur,
 * ça passe par une route ordinaire sans serveur à part, et `EventSource` se
 * reconnecte tout seul.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Non autorisé", { status: 401 });

  const videoId = new URL(request.url).searchParams.get("video");
  if (videoId) {
    // Même règle que pour lire la vidéo : on ne suit pas, et on n'apparaît
    // pas dans la présence, d'un montage qu'on n'a pas le droit de voir.
    const access = await readVideoOr404(videoId);
    if (access instanceof Response) return access;
  }

  const encoder = new TextEncoder();
  let close = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      const send: Send = (event, data) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const leave = videoId
        ? watchVideo(
            videoId,
            { id: viewer.id, name: viewer.name, color: userColorIndex(viewer.id) },
            send,
          )
        : watchLibrary(send);
      const heartbeat = setInterval(() => write(": actif\n\n"), HEARTBEAT_MS);

      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        leave();
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // nginx met les réponses en tampon par défaut, ce qui retiendrait les
      // événements jusqu'à la fermeture du flux.
      "X-Accel-Buffering": "no",
    },
  });
}
