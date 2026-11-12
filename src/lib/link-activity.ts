import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { shareLinkEvents, type LinkEventType } from "@/db/schema";

/** Un même « a regardé » n'est noté qu'une fois par heure et par vidéo. */
const VIEW_WINDOW_MS = 60 * 60 * 1000;

/**
 * Note ce qu'un visiteur vient de faire, sur chacun des liens par lesquels il
 * atteint la vidéo. Le plus souvent il n'y en a qu'un.
 *
 * Jamais bloquant : c'est un journal, pas un contrôle. Une écriture qui
 * échoue ne doit ni refuser la lecture ni faire perdre une note.
 */
export function recordLinkEvent(
  linkIds: string[],
  type: LinkEventType,
  name: string,
  videoId: string | null,
) {
  try {
    for (const linkId of linkIds) {
      // Chaque rendu de la page compterait pour une visite : on ne garde
      // qu'une ligne par heure, sinon le journal ne dit plus rien.
      if (type === "viewed") {
        const recent = db
          .select({ id: shareLinkEvents.id })
          .from(shareLinkEvents)
          .where(
            and(
              eq(shareLinkEvents.linkId, linkId),
              eq(shareLinkEvents.type, "viewed"),
              eq(shareLinkEvents.name, name),
              videoId === null ? undefined : eq(shareLinkEvents.videoId, videoId),
              gt(shareLinkEvents.createdAt, Date.now() - VIEW_WINDOW_MS),
            ),
          )
          .get();
        if (recent) continue;
      }
      db.insert(shareLinkEvents)
        .values({ id: randomUUID(), linkId, type, name, videoId, createdAt: Date.now() })
        .run();
    }
  } catch {
    // Voir plus haut : le journal ne casse jamais ce qu'il observe.
  }
}

export type LinkActivity = {
  id: string;
  type: LinkEventType;
  name: string;
  createdAt: number;
};

/** Les derniers événements d'un lien, du plus récent au plus ancien. */
export function listLinkActivity(linkId: string, limit = 30): LinkActivity[] {
  return db
    .select({
      id: shareLinkEvents.id,
      type: shareLinkEvents.type,
      name: shareLinkEvents.name,
      createdAt: shareLinkEvents.createdAt,
    })
    .from(shareLinkEvents)
    .where(eq(shareLinkEvents.linkId, linkId))
    .orderBy(desc(shareLinkEvents.createdAt))
    .limit(limit)
    .all();
}
