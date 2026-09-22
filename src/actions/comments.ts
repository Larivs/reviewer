"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { FORBIDDEN, requireVideoAccess } from "@/lib/access";
import {
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
import { getVideo } from "@/lib/videos";
import { sanitizeAnnotation, serializeAnnotation } from "@/lib/annotation";
import type { ActionResult } from "./folders";

function refresh() {
  revalidatePath("/", "layout");
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
};

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
  });
  refresh();
  return { ok: true, id: created.id };
}

export async function updateCommentAction(
  id: string,
  rawBody: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const comment = getComment(id);
  if (!comment) return { ok: false, error: "Ce commentaire n'existe plus." };
  if (!(await requireVideoAccess(comment.videoId))) return FORBIDDEN;
  // On ne modifie que ses propres notes : réécrire celle d'un autre
  // fausserait la review.
  if (comment.userId !== user.id)
    return { ok: false, error: "Tu ne peux modifier que tes propres commentaires." };

  const checked = validateBody(rawBody);
  if ("error" in checked) return { ok: false, error: checked.error };

  updateCommentBody(id, checked.body);
  refresh();
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
  refresh();
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
  if (!(await requireVideoAccess(comment.videoId))) return FORBIDDEN;

  setCommentResolved(id, resolved);
  refresh();
  return { ok: true };
}

/**
 * Répondre à une note, **y compris celle d'un autre**. C'est tout l'objet du
 * fil : jusqu'ici, contester ou préciser une note demandait d'en écrire une
 * seconde au même timecode, et la piste se retrouvait avec deux repères pour
 * une seule question. Modifier la note d'autrui reste interdit — on ajoute
 * sous la sienne, on ne réécrit pas la sienne.
 */
export async function createReplyAction(
  commentId: string,
  rawBody: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const comment = getComment(commentId);
  if (!comment) return { ok: false, error: "Ce commentaire n'existe plus." };
  if (!(await requireVideoAccess(comment.videoId))) return FORBIDDEN;

  const checked = validateBody(rawBody);
  if ("error" in checked) return { ok: false, error: checked.error };

  insertReply({ commentId, userId: user.id, body: checked.body });
  refresh();
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
  refresh();
  return { ok: true };
}
