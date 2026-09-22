import { readFile } from "node:fs/promises";
import { readVideoOr404 } from "@/lib/access";
import { spritePath } from "@/lib/videos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Deviner une URL ne suffit plus : il faut que la vidéo soit dans la portée
  // du compte. Sans ça, un invité d'un seul projet lirait la planche d'aperçu de tous
  // les autres.
  const access = await readVideoOr404(id);
  if (access instanceof Response) return access;
  try {
    const jpeg = await readFile(spritePath(id));
    return new Response(jpeg as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/jpeg",
        // La planche d'une vidéo ne change jamais. `private` parce qu'elle
        // est derrière le mot de passe comme la vidéo elle-même.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    // Vidéo envoyée avant l'arrivée de cette fonction : pas de planche,
    // la piste se contentera d'afficher le timecode au survol.
    return new Response("Pas de planche", { status: 404 });
  }
}
