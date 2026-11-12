import "server-only";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { asc, count, eq, isNull, max } from "drizzle-orm";
import { db, SPRITE_DIR, THUMB_DIR, VIDEO_DIR } from "@/db";
import { comments, videos, type VideoState, type VideoStatus } from "@/db/schema";
import { scopeAllowsFolder, type Scope } from "./scope";

export type Video = typeof videos.$inferSelect;
/**
 * Une vignette de grille porte aussi le nombre de notes en attente, et le
 * nombre de versions de sa pile : la grille ne montre que la dernière.
 */
export type VideoListItem = Video & { openComments: number; versionCount: number };

/** Extensions acceptées sur disque. Le contenu, lui, est validé par ffprobe. */
const KNOWN_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv"]);

/** Fichier d'un envoi en cours, par compte et par empreinte du fichier. */
export function partPath(userId: string, key: string) {
  return path.join(VIDEO_DIR, `envoi-${path.basename(userId)}-${path.basename(key)}.part`);
}

/**
 * Nom sur disque de l'original, quand on le garde à côté de sa copie lisible.
 * L'extension d'origine est conservée si elle est banale, pour que le
 * fichier téléchargé s'ouvre dans le bon logiciel.
 */
export function originalFilename(id: string, uploadName: string) {
  const ext = path.extname(uploadName).slice(1).toLowerCase();
  return `${path.basename(id)}.orig.${/^[a-z0-9]{1,5}$/.test(ext) ? ext : "bin"}`;
}

/** Le fichier à rendre quand on demande l'original d'une vidéo. */
export function originalPath(video: Video) {
  return videoPath(video.original ?? video.filename);
}

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
    return withOpenCounts(latestOfEachStack(granted));
  }

  // Hors de la portée, il n'y a rien à montrer, et surtout rien à compter :
  // même un décompte de notes renseignerait sur un projet qu'on ne doit pas
  // savoir exister.
  if (!scopeAllowsFolder(scope, folderId)) return [];

  const rows = db
    .select()
    .from(videos)
    .where(folderId === null ? isNull(videos.folderId) : eq(videos.folderId, folderId))
    .orderBy(asc(videos.name))
    .all();

  return withOpenCounts(latestOfEachStack(rows));
}

/**
 * Une pile de versions tient en une vignette, celle de la plus récente :
 * c'est elle qu'on review, les précédentes se retrouvent depuis sa page.
 */
function latestOfEachStack(rows: Video[]): (Video & { versionCount: number })[] {
  const latest = new Map<string, Video & { versionCount: number }>();
  for (const row of rows) {
    const key = row.stackId ?? row.id;
    const seen = latest.get(key);
    if (!seen) latest.set(key, { ...row, versionCount: 1 });
    else
      latest.set(key, {
        ...(row.version > seen.version ? row : seen),
        versionCount: seen.versionCount + 1,
      });
  }
  // L'ordre d'arrivée est celui de la requête, par nom : on le garde.
  return [...latest.values()];
}

/** Toutes les versions de la pile d'une vidéo, de la première à la dernière. */
export function listVersions(video: Video): Video[] {
  if (!video.stackId) return [video];
  return db
    .select()
    .from(videos)
    .where(eq(videos.stackId, video.stackId))
    .orderBy(asc(videos.version))
    .all();
}

/**
 * Ajoute une version à la pile de `base`. La première version reçoit son
 * `stackId` à ce moment-là seulement, d'où la transaction : sans elle, un
 * arrêt entre les deux écritures laisserait une v2 sans v1.
 */
export function insertVersion(base: Video, video: Omit<Video, "stackId" | "version">) {
  return db.transaction((tx) => {
    const stackId = base.stackId ?? base.id;
    if (!base.stackId)
      tx.update(videos).set({ stackId }).where(eq(videos.id, base.id)).run();
    const top = tx
      .select({ n: max(videos.version) })
      .from(videos)
      .where(eq(videos.stackId, stackId))
      .get();
    const row = { ...video, stackId, version: (top?.n ?? 1) + 1 };
    tx.insert(videos).values(row).run();
    return row;
  });
}

/** Toute la pile ou la vidéo seule : ce qu'un renommage ou un rangement vise. */
function wholeStack(video: Video) {
  return video.stackId ? eq(videos.stackId, video.stackId) : eq(videos.id, video.id);
}

/**
 * Un seul agrégat pour toute la grille : le nombre de notes ouvertes est le
 * signal qu'on cherche en arrivant dans un dossier.
 */
function withOpenCounts(rows: (Video & { versionCount: number })[]): VideoListItem[] {
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

/** Les versions d'un montage portent le même nom : on les renomme ensemble. */
export function renameVideo(video: Video, name: string) {
  db.update(videos).set({ name }).where(wholeStack(video)).run();
}

/**
 * Le fichier sur disque ne bouge pas : le dossier n'est qu'un rangement.
 * La pile se déplace entière, une version restée dans l'ancien dossier
 * deviendrait invisible depuis la vignette.
 */
export function moveVideo(video: Video, folderId: string | null) {
  db.update(videos).set({ folderId }).where(wholeStack(video)).run();
}

export function setVideoState(id: string, state: VideoState, size?: number) {
  db.update(videos)
    .set(size === undefined ? { state } : { state, size })
    .where(eq(videos.id, id))
    .run();
}

export function setVideoStatus(id: string, status: VideoStatus) {
  db.update(videos).set({ status }).where(eq(videos.id, id)).run();
}

/** Retire la ligne, puis le fichier et sa vignette. */
export async function deleteVideo(video: Video) {
  db.delete(videos).where(eq(videos.id, video.id)).run();

  await Promise.all(
    [
      videoPath(video.filename),
      thumbnailPath(video.id),
      spritePath(video.id),
      ...(video.original ? [videoPath(video.original)] : []),
    ].map((p) =>
      // Un fichier déjà absent n'est pas une erreur : la base est la référence.
      unlink(p).catch(() => {}),
    ),
  );
}

/** Supprime toutes les versions d'un montage : c'est ce que vise la vignette. */
export async function deleteVideoStack(video: Video) {
  for (const version of listVersions(video)) await deleteVideo(version);
}
