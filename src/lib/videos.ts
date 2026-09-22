import "server-only";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { asc, count, eq, isNull } from "drizzle-orm";
import { db, SPRITE_DIR, THUMB_DIR, VIDEO_DIR } from "@/db";
import { comments, videos, type VideoStatus } from "@/db/schema";
import { scopeAllowsFolder, type Scope } from "./scope";

export type Video = typeof videos.$inferSelect;
/** Une vignette de grille porte aussi le nombre de notes en attente. */
export type VideoListItem = Video & { openComments: number };

/** Extensions acceptées sur disque. Le contenu, lui, est validé par ffprobe. */
const KNOWN_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv"]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 * 1024; // 25 Go

export function videoPath(filename: string) {
  // basename() empêche qu'un nom stocké en base puisse remonter l'arborescence.
  return path.join(VIDEO_DIR, path.basename(filename));
}

export function thumbnailPath(id: string) {
  return path.join(THUMB_DIR, `${path.basename(id)}.jpg`);
}

export function spritePath(id: string) {
  return path.join(SPRITE_DIR, `${path.basename(id)}.jpg`);
}

/** Extension normalisée, ou "bin" si elle est inhabituelle. */
export function safeExtension(originalName: string) {
  const ext = path.extname(originalName).slice(1).toLowerCase();
  return KNOWN_EXTENSIONS.has(ext) ? ext : "bin";
}

/** Nom affiché : le fichier d'origine sans son extension. */
export function displayName(originalName: string) {
  const base = path.basename(originalName);
  const withoutExt = base.replace(/\.[^.]+$/, "");
  return (withoutExt || base).trim().slice(0, 200);
}

export function listVideos(
  folderId: string | null,
  scope: Scope = null,
): VideoListItem[] {
  // À la racine, un invité ne voit pas le fond de l'espace : il voit les
  // vidéos qu'on lui a ouvertes une à une. C'est le pendant de `listFolders`,
  // qui lui présente ses projets comme s'ils étaient au premier niveau.
  if (scope !== null && folderId === null) {
    if (scope.videos.size === 0) return [];
    const granted = db
      .select()
      .from(videos)
      .orderBy(asc(videos.name))
      .all()
      .filter((v) => scope.videos.has(v.id));
    return withOpenCounts(granted);
  }

  // Hors de la portée, il n'y a rien à montrer — et surtout rien à compter :
  // même un décompte de notes renseignerait sur un projet qu'on ne doit pas
  // savoir exister.
  if (!scopeAllowsFolder(scope, folderId)) return [];

  const rows = db
    .select()
    .from(videos)
    .where(folderId === null ? isNull(videos.folderId) : eq(videos.folderId, folderId))
    .orderBy(asc(videos.name))
    .all();

  return withOpenCounts(rows);
}

/**
 * Un seul agrégat pour toute la grille : le nombre de notes ouvertes est le
 * signal qu'on cherche en arrivant dans un dossier.
 */
function withOpenCounts(rows: Video[]): VideoListItem[] {
  if (rows.length === 0) return [];

  const open = new Map(
    db
      .select({ videoId: comments.videoId, n: count() })
      .from(comments)
      .where(eq(comments.resolved, false))
      .groupBy(comments.videoId)
      .all()
      .map((r) => [r.videoId, r.n]),
  );

  return rows.map((v) => ({ ...v, openComments: open.get(v.id) ?? 0 }));
}

export function getVideo(id: string) {
  return db.select().from(videos).where(eq(videos.id, id)).get() ?? null;
}

export function insertVideo(video: Video) {
  db.insert(videos).values(video).run();
  return video;
}

export function renameVideo(id: string, name: string) {
  db.update(videos).set({ name }).where(eq(videos.id, id)).run();
}

/** Le fichier sur disque ne bouge pas : le dossier n'est qu'un rangement. */
export function moveVideo(id: string, folderId: string | null) {
  db.update(videos).set({ folderId }).where(eq(videos.id, id)).run();
}

export function setVideoStatus(id: string, status: VideoStatus) {
  db.update(videos).set({ status }).where(eq(videos.id, id)).run();
}

/** Retire la ligne, puis le fichier et sa vignette. */
export async function deleteVideo(video: Video) {
  db.delete(videos).where(eq(videos.id, video.id)).run();

  await Promise.all(
    [videoPath(video.filename), thumbnailPath(video.id), spritePath(video.id)].map((p) =>
      // Un fichier déjà absent n'est pas une erreur : la base est la référence.
      unlink(p).catch(() => {}),
    ),
  );
}
