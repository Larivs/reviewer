"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  FORBIDDEN,
  isGuest,
  requireStaff,
  requireVideoAccess,
  videoCapabilities,
  type Viewer,
} from "@/lib/access";
import { recordLinkEvent } from "@/lib/link-activity";
import type { Video } from "@/lib/videos";
import {
  carryOpenComments,
  deleteComment,
  deleteReply,
  getComment,
  getReply,
  insertComment,
  insertReply,
  MAX_BODY_LENGTH,
  normalizeBody,
  setCommentResolved,
  updateCommentBody,
} from "@/lib/comments";
import { notifyComments, notifyFolderChanged } from "@/lib/live";
import { notifyNote } from "@/lib/notify";
import { listVersions } from "@/lib/videos";
import { formatClock } from "@/lib/timecode";
import { sanitizeAnnotation, serializeAnnotation } from "@/lib/annotation";
import type { ActionResult } from "./folders";

/**
 * Après toute écriture : la page de l'auteur, puis les autres. Ceux qui
 * regardent la même vidéo rechargent ses notes, et la grille son décompte
 * de notes ouvertes.
 */
function changed(videoId: string) {
  revalidatePath("/", "layout");
  notifyComments(videoId);
  notifyFolderChanged();
}

function validateBody(raw: string): { body: string } | { error: string } {
  const body = normalizeBody(raw);
  if (!body) return { error: "Le commentaire est vide." };
  if (body.length > MAX_BODY_LENGTH)
    return { error: `${MAX_BODY_LENGTH} caractères maximum.` };
  return { body };
}

export type NewComment = {
  videoId: string;
  timecode: number;
  /** Fin de plage, ou `null` pour un instant unique. */
  timecodeEnd?: number | null;
  body: string;
  /** Formes dessinées, telles que produites par le navigateur. */
  annotation?: unknown;
  /** Note interne au studio. Ignoré si l'auteur est un invité. */
  internal?: boolean;
};

/** Un invité qui commente : on le note sur le lien par lequel il est entré. */
function logGuestComment(viewer: Viewer, video: Video) {
  if (!isGuest(viewer)) return;
  recordLinkEvent(videoCapabilities(viewer, video).linkIds, "commented", viewer.name, video.id);
}

/**
 * Une note interne n'existe pas pour un invité : ni à lire, ni à modifier en
 * devinant son identifiant. Même réponse que pour une note supprimée.
 */
const hiddenFrom = (viewer: Viewer, comment: { internal: boolean }) =>
  comment.internal && isGuest(viewer);
const GONE = { ok: false as const, error: "Ce commentaire n'existe plus." };

/**
 * La création rend l'identifiant de la note : l'interface doit pouvoir la
 * mettre en avant tout de suite. Sans ça, la note qu'on venait d'écrire se
 * fondait dans la liste et il fallait la chercher.
 */
export type CreateCommentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createCommentAction(
  input: NewComment,
): Promise<CreateCommentResult> {
  const user = await requireUser();

  // Écrire sur une vidéo hors portée reviendrait à s'inviter dans la review
  // d'un autre client en devinant un identifiant.
  const access = await requireVideoAccess(input.videoId);
  if (!access) return { ok: false, error: "Cette vidéo n'existe plus." };
  const video = access.video;

  const checked = validateBody(input.body);
  if ("error" in checked) return { ok: false, error: checked.error };

  if (!Number.isFinite(input.timecode) || input.timecode < 0)
    return { ok: false, error: "Timecode invalide." };

  // On borne au métrage : un timecode au-delà de la fin renverrait vers du
  // vide au moment de cliquer sur le commentaire.
  const limit = video.duration ?? input.timecode;
  const timecode = Math.min(Math.max(0, input.timecode), limit);

  let timecodeEnd: number | null = null;
  if (input.timecodeEnd != null && Number.isFinite(input.timecodeEnd)) {
    const end = Math.min(Math.max(0, input.timecodeEnd), limit);
    // Une plage inversée ou nulle n'a pas de sens : on la ramène à un point.
    if (end > timecode + 0.01) timecodeEnd = end;
  }

  // Le dessin vient du navigateur et sera réaffiché tel quel : on le
  // nettoie entièrement plutôt que de faire confiance à sa forme.
  const annotation = serializeAnnotation(sanitizeAnnotation(input.annotation));

  const created = insertComment({
    videoId: input.videoId,
    userId: user.id,
    timecode,
    timecodeEnd,
    annotation,
    body: checked.body,
    // Seul le studio écrit en interne : pour un invité, le drapeau venu du
    // navigateur est ignoré, sa note serait invisible à lui-même.
    internal: input.internal === true && !isGuest(access.viewer),
  });
  changed(input.videoId);
  logGuestComment(access.viewer, video);
  notifyNote(
    {
      type: "note",
      video,
      author: user.name,
      summary: `${user.name} a posé une note sur « ${video.name} » à ${formatClock(timecode)}`,
      body: checked.body,
    },
    user.id,
    created.internal,
  );
  return { ok: true, id: created.id };
}

export async function updateCommentAction(
  id: string,
  rawBody: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const comment = getComment(id);
  if (!comment) return { ok: false, error: "Ce commentaire n'existe plus." };
  const seen = await requireVideoAccess(comment.videoId);
  if (!seen) return FORBIDDEN;
  if (hiddenFrom(seen.viewer, comment)) return GONE;
  // On ne modifie que ses propres notes : réécrire celle d'un autre
  // fausserait la review.
  if (comment.userId !== user.id)
    return { ok: false, error: "Tu ne peux modifier que tes propres commentaires." };

  const checked = validateBody(rawBody);
  if ("error" in checked) return { ok: false, error: checked.error };

  updateCommentBody(id, checked.body);
  changed(comment.videoId);
  return { ok: true };
}

export async function deleteCommentAction(id: string): Promise<ActionResult> {
  const user = await requireUser();

  const comment = getComment(id);
  if (!comment) return { ok: false, error: "Ce commentaire n'existe plus." };
  if (!(await requireVideoAccess(comment.videoId))) return FORBIDDEN;
  if (comment.userId !== user.id)
    return { ok: false, error: "Tu ne peux supprimer que tes propres commentaires." };

  deleteComment(id);
  changed(comment.videoId);
  return { ok: true };
}

/**
 * Résoudre est un signal d'avancement partagé : n'importe qui de l'équipe
 * peut marquer une note comme traitée, y compris le monteur qui l'applique.
 */
export async function toggleCommentResolvedAction(
  id: string,
  resolved: boolean,
): Promise<ActionResult> {
  await requireUser();

  const comment = getComment(id);
  if (!comment) return { ok: false, error: "Ce commentaire n'existe plus." };
  const seen = await requireVideoAccess(comment.videoId);
  if (!seen) return FORBIDDEN;
  if (hiddenFrom(seen.viewer, comment)) return GONE;

  setCommentResolved(id, resolved);
  changed(comment.videoId);
  return { ok: true };
}

/**
 * Répondre à une note, **y compris celle d'un autre**. C'est tout l'objet du
 * fil : jusqu'ici, contester ou préciser une note demandait d'en écrire une
 * seconde au même timecode, et la piste se retrouvait avec deux repères pour
 * une seule question. Modifier la note d'autrui reste interdit, on ajoute
 * sous la sienne, on ne réécrit pas la sienne.
 */
export async function createReplyAction(
  commentId: string,
  rawBody: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const comment = getComment(commentId);
  if (!comment) return { ok: false, error: "Ce commentaire n'existe plus." };
  const access = await requireVideoAccess(comment.videoId);
  if (!access) return FORBIDDEN;
  if (hiddenFrom(access.viewer, comment)) return GONE;

  const checked = validateBody(rawBody);
  if ("error" in checked) return { ok: false, error: checked.error };

  insertReply({ commentId, userId: user.id, body: checked.body });
  changed(comment.videoId);
  notifyNote(
    {
      type: "reponse",
      video: access.video,
      author: user.name,
      summary: `${user.name} a répondu sur « ${access.video.name} » à ${formatClock(comment.timecode)}`,
      body: checked.body,
    },
    user.id,
    comment.internal,
  );
  logGuestComment(access.viewer, access.video);
  return { ok: true };
}

export async function deleteReplyAction(id: string): Promise<ActionResult> {
  const user = await requireUser();

  const reply = getReply(id);
  if (!reply) return { ok: false, error: "Cette réponse n'existe plus." };
  const parent = getComment(reply.commentId);
  if (!parent || !(await requireVideoAccess(parent.videoId))) return FORBIDDEN;
  if (reply.userId !== user.id)
    return { ok: false, error: "Tu ne peux supprimer que tes propres réponses." };

  deleteReply(id);
  changed(parent.videoId);
  return { ok: true };
}

/**
 * Reporte sur cette version les notes ouvertes de la précédente. Geste du
 * studio : c'est lui qui juge, version en main, ce qui reste à faire.
 */
export async function carryNotesAction(
  videoId: string,
): Promise<{ ok: true; carried: number } | { ok: false; error: string }> {
  if (!(await requireStaff())) return FORBIDDEN;
  const access = await requireVideoAccess(videoId);
  if (!access) return { ok: false, error: "Cette vidéo n'existe plus." };

  const versions = listVersions(access.video);
  const previous = versions.filter((v) => v.version < access.video.version).pop();
  if (!previous) return { ok: false, error: "Il n'y a pas de version précédente." };

  const carried = carryOpenComments(previous.id, videoId, access.video.duration);
  changed(videoId);
  return { ok: true, carried };
}
