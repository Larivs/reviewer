"use server";

import { revalidatePath } from "next/cache";
import { FORBIDDEN, requireStaff, requireVideoAccess } from "@/lib/access";
import { getFolder, MAX_NAME_LENGTH, normalizeName } from "@/lib/folders";
import {
  deleteVideo,
  getVideo,
  moveVideo,
  renameVideo,
  setVideoStatus,
} from "@/lib/videos";
import { VIDEO_STATUSES, type VideoStatus } from "@/db/schema";
import type { ActionResult } from "./folders";

function refresh() {
  revalidatePath("/", "layout");
}

export async function renameVideoAction(
  id: string,
  rawName: string,
): Promise<ActionResult> {
  if (!(await requireStaff())) return FORBIDDEN;

  const video = getVideo(id);
  if (!video) return { ok: false, error: "Cette vidéo n'existe plus." };

  const name = normalizeName(rawName);
  if (!name) return { ok: false, error: "Le nom ne peut pas être vide." };
  if (rawName.trim().length > MAX_NAME_LENGTH)
    return { ok: false, error: `${MAX_NAME_LENGTH} caractères maximum.` };

  renameVideo(id, name);
  refresh();
  return { ok: true };
}

/** Range la vidéo dans un autre dossier. `null` = la racine. */
export async function moveVideoAction(
  id: string,
  folderId: string | null,
): Promise<ActionResult> {
  if (!(await requireStaff())) return FORBIDDEN;

  const video = getVideo(id);
  if (!video) return { ok: false, error: "Cette vidéo n'existe plus." };
  // La destination vient du navigateur : on vérifie qu'elle existe encore,
  // sinon la vidéo disparaîtrait de l'arbre sans être supprimée.
  if (folderId !== null && !getFolder(folderId))
    return { ok: false, error: "Ce dossier n'existe plus." };
  if ((video.folderId ?? null) === folderId) return { ok: true };

  moveVideo(id, folderId);
  refresh();
  return { ok: true };
}

export async function deleteVideoAction(id: string): Promise<ActionResult> {
  if (!(await requireStaff())) return FORBIDDEN;

  const video = getVideo(id);
  if (!video) return { ok: false, error: "Cette vidéo n'existe plus." };

  await deleteVideo(video);
  refresh();
  return { ok: true };
}

/**
 * Le statut est un signal d'équipe : tout le monde le change, invités
 * compris — c'est souvent le client qui dit « validé ». Mais seulement sur
 * une vidéo qu'il a le droit de voir.
 */
export async function setVideoStatusAction(
  id: string,
  status: string,
): Promise<ActionResult> {
  if (!(await requireVideoAccess(id))) return FORBIDDEN;
  // On valide contre la liste connue : la valeur vient du navigateur.
  if (!VIDEO_STATUSES.includes(status as VideoStatus))
    return { ok: false, error: "Statut inconnu." };

  setVideoStatus(id, status as VideoStatus);
  refresh();
  return { ok: true };
}

/** Appelé après un envoi réussi pour rafraîchir la grille. */
export async function refreshAfterUpload() {
  if (!(await requireStaff())) return;
  refresh();
}
