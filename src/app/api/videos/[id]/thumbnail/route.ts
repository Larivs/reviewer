import { readFile } from "node:fs/promises";
import { readVideoOr404 } from "@/lib/access";
import { thumbnailPath } from "@/lib/videos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Deviner une URL ne suffit plus : il faut que la vidéo soit dans la portée
  // du compte. Sans ça, un invité d'un seul projet lirait la vignette de tous
  // les autres.
  const access = await readVideoOr404(id);
  if (access instanceof Response) return access;
  try {
    const jpeg = await readFile(thumbnailPath(id));
    return new Response(jpeg as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/jpeg",
        // La vignette d'une vidéo ne change jamais : on la met en cache
        // longtemps, mais en `private` puisqu'elle est derrière le mot de passe.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Pas de vignette", { status: 404 });
  }
}
