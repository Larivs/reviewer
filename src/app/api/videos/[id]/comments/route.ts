import { isGuest, readVideoOr404 } from "@/lib/access";
import { listComments } from "@/lib/comments";

export const dynamic = "force-dynamic";

/**
 * Liste des notes en JSON, pour le sondage de l'espace de review.
 *
 * Une route de lecture séparée, et non `router.refresh()` : rafraîchir la
 * route entière ferait re-rendre le lecteur, et on ne touche pas au lecteur
 * pendant qu'une vidéo joue. Ici on ne rapporte que des données, le
 * navigateur décide ensuite si quelque chose a changé.
 *
 * Session vérifiée comme pour le flux vidéo et les vignettes : deviner une
 * URL ne doit pas suffire à lire les notes d'une équipe.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await readVideoOr404(id);
  if (access instanceof Response) return access;

  return Response.json(listComments(id, { includeInternal: !isGuest(access.viewer) }), {
    // Jamais de cache : c'est exactement la fraîcheur qu'on vient chercher.
    headers: { "Cache-Control": "no-store" },
  });
}
