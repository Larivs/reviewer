"use server";

import { db } from "@/db";
import { videos } from "@/db/schema";
import { getScope, scopeAllowsVideo } from "@/lib/access";
import { listFolderOptions } from "@/lib/folders";

export type SearchHit = {
  kind: "folder" | "video";
  id: string;
  name: string;
  /** Où ça se trouve, pour distinguer deux « Rushes ». */
  context: string;
};

const MAX_HITS = 12;

/** Minuscules sans accents : « resume » trouve « Résumé ». */
const fold = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Recherche de la palette de commandes, dans les projets et les vidéos.
 *
 * La portée s'applique ici comme partout : un invité ne trouve que ce qu'on
 * lui a ouvert, et le chemin affiché ne remonte pas au-dessus de ses projets
 * (`listFolderOptions` ne lui rend que ses dossiers).
 */
export async function searchLibraryAction(raw: string): Promise<SearchHit[]> {
  // `getScope` redirige vers la connexion s'il n'y a pas de session.
  const scope = await getScope();
  const query = fold(String(raw).trim()).slice(0, 80);
  if (!query) return [];

  const folders = listFolderOptions(scope);
  const pathOf = new Map(folders.map((f) => [f.id, f.label]));

  const folderHits: SearchHit[] = folders
    .filter((f) => fold(f.label.split(" / ").pop() ?? "").includes(query))
    .map((f) => {
      const parts = f.label.split(" / ");
      return {
        kind: "folder" as const,
        id: f.id,
        name: parts[parts.length - 1],
        context: parts.slice(0, -1).join(" / ") || "Projets",
      };
    });

  // Une pile de versions ne donne qu'un résultat, sa dernière version.
  const latest = new Map<string, typeof videos.$inferSelect>();
  for (const video of db.select().from(videos).all()) {
    if (!scopeAllowsVideo(scope, video) || !fold(video.name).includes(query)) continue;
    const key = video.stackId ?? video.id;
    const seen = latest.get(key);
    if (!seen || video.version > seen.version) latest.set(key, video);
  }
  const videoHits: SearchHit[] = [...latest.values()].map((v) => ({
    kind: "video" as const,
    id: v.id,
    name: v.name,
    context: (v.folderId && pathOf.get(v.folderId)) || "Projets",
  }));

  return [...folderHits, ...videoHits]
    .sort((x, y) => x.name.localeCompare(y.name, "fr"))
    .slice(0, MAX_HITS);
}
