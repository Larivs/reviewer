import "server-only";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { folders, videos } from "@/db/schema";
import { spritePath, thumbnailPath, videoPath } from "./videos";
import type { Scope } from "./scope";

export const MAX_NAME_LENGTH = 120;
/** Garde-fou : une boucle parent/enfant en base ne doit pas figer le rendu. */
const MAX_DEPTH = 64;

export type Folder = typeof folders.$inferSelect;
export type FolderListItem = Folder & { folderCount: number; videoCount: number };

export function getFolder(id: string) {
  return db.select().from(folders).where(eq(folders.id, id)).get() ?? null;
}

/** Chemin de la racine jusqu'au dossier, pour le fil d'Ariane. */
export function getBreadcrumb(id: string): Folder[] {
  const trail: Folder[] = [];
  let current = getFolder(id);
  let depth = 0;

  while (current && depth < MAX_DEPTH) {
    trail.unshift(current);
    current = current.parentId ? getFolder(current.parentId) : null;
    depth += 1;
  }
  return trail;
}

/**
 * Dossiers directement contenus, avec de quoi afficher leur remplissage.
 *
 * La portée (`scope`) filtre le résultat pour un invité. À la racine elle
 * fait davantage que filtrer : elle **remplace** le premier niveau par les
 * projets qu'on lui a ouverts. Un client n'a pas à savoir que son projet est
 * rangé au milieu de ceux des autres, chez lui, il est à la racine.
 */
export function listFolders(
  parentId: string | null,
  scope: Scope = null,
): FolderListItem[] {
  const rows = (
    scope !== null && parentId === null
      ? // `inArray` demanderait un cas particulier pour la liste vide ; à
        // cette échelle un filtre en mémoire coûte moins qu'un branchement.
        db.select().from(folders).orderBy(asc(folders.name)).all()
          .filter((f) => scope.roots.includes(f.id))
      : db
          .select()
          .from(folders)
          .where(parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId))
          .orderBy(asc(folders.name))
          .all()
  ).filter((f) => scope === null || scope.visible.has(f.id));

  if (rows.length === 0) return [];

  // Deux agrégats globaux plutôt qu'une requête par dossier : à cette
  // échelle c'est gratuit, et ça évite un N+1 qui grossirait avec l'arbre.
  const subFolders = new Map(
    db
      .select({ parentId: folders.parentId, n: count() })
      .from(folders)
      .groupBy(folders.parentId)
      .all()
      .map((r) => [r.parentId, r.n]),
  );
  const videoCounts = new Map(
    db
      .select({ folderId: videos.folderId, n: count() })
      .from(videos)
      .groupBy(videos.folderId)
      .all()
      .map((r) => [r.folderId, r.n]),
  );

  return rows.map((f) => ({
    ...f,
    folderCount: subFolders.get(f.id) ?? 0,
    videoCount: videoCounts.get(f.id) ?? 0,
  }));
}

/** Une destination possible pour un déplacement. */
export type FolderOption = { id: string; label: string };

/**
 * Tous les dossiers à plat, en ordre d'arbre, avec leur chemin complet en
 * libellé. On descend depuis la racine plutôt que de trier par nom : un
 * sélecteur de destination doit montrer « Client Numspot / Rushes » sous
 * son parent, sinon on ne sait pas où on envoie le fichier. Le `seen` et la
 * profondeur bornée protègent d'un cycle parent/enfant en base.
 */
export function listFolderOptions(scope: Scope = null): FolderOption[] {
  const rows = db
    .select()
    .from(folders)
    .orderBy(asc(folders.name))
    .all()
    .filter((f) => scope === null || scope.visible.has(f.id));

  const children = new Map<string | null, Folder[]>();
  for (const folder of rows) {
    const key = folder.parentId ?? null;
    const list = children.get(key);
    if (list) list.push(folder);
    else children.set(key, [folder]);
  }

  const options: FolderOption[] = [];
  const seen = new Set<string>();

  const walk = (parentId: string | null, trail: string[]) => {
    if (trail.length >= MAX_DEPTH) return;
    for (const folder of children.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      const path = [...trail, folder.name];
      options.push({ id: folder.id, label: path.join(" / ") });
      walk(folder.id, path);
    }
  };
  walk(null, []);

  return options;
}

export function normalizeName(raw: string) {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

/** Un même parent ne peut pas contenir deux dossiers de même nom. */
export function nameTaken(parentId: string | null, name: string, exceptId?: string) {
  const existing = db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
        eq(sql`lower(${folders.name})`, name.toLowerCase()),
      ),
    )
    .all();

  return existing.some((f) => f.id !== exceptId);
}

export function createFolder(parentId: string | null, name: string) {
  const folder = { id: randomUUID(), parentId, name, createdAt: Date.now() };
  db.insert(folders).values(folder).run();
  return folder;
}

export function renameFolder(id: string, name: string) {
  db.update(folders).set({ name }).where(eq(folders.id, id)).run();
}

/**
 * Supprime le dossier et tout ce qu'il contient. Les lignes partent en
 * cascade via les clés étrangères, mais les fichiers sur disque doivent être
 * retirés à la main, sinon ils s'accumulent invisiblement. Vignettes
 * comprises : elles sont nommées d'après l'id de la vidéo, pas son fichier.
 */
export async function deleteFolderRecursive(id: string) {
  const rows = db.all<{ id: string; filename: string }>(
    sql`WITH RECURSIVE tree(id) AS (
          SELECT ${id}
          UNION ALL
          SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
        )
        SELECT id, filename FROM videos WHERE folder_id IN (SELECT id FROM tree)`,
  );

  db.delete(folders).where(eq(folders.id, id)).run();

  await Promise.all(
    rows
      .flatMap((row) => [
        videoPath(row.filename),
        thumbnailPath(row.id),
        spritePath(row.id),
      ])
      // Un fichier déjà absent n'est pas une erreur : la base reste la
      // référence, le disque suit.
      .map((file) => unlink(file).catch(() => {})),
  );
}

/** Contenu total d'un dossier, pour prévenir avant une suppression. */
export function countDescendants(id: string) {
  const row = db.get<{ folders: number; videos: number }>(
    sql`WITH RECURSIVE tree(id) AS (
          SELECT ${id}
          UNION ALL
          SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
        )
        SELECT
          (SELECT count(*) FROM tree) - 1                                   AS folders,
          (SELECT count(*) FROM videos WHERE folder_id IN (SELECT id FROM tree)) AS videos`,
  );
  return { folders: row?.folders ?? 0, videos: row?.videos ?? 0 };
}
