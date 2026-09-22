import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { commentReplies, comments, users } from "@/db/schema";
import { userColorIndexes } from "./users";

export const MAX_BODY_LENGTH = 2000;

/**
 * Réponse à une note. Pas de timecode ni d'état résolu : c'est une prise de
 * parole dans un fil, pas une seconde note.
 */
export type CommentReply = {
  id: string;
  commentId: string;
  userId: string;
  authorName: string;
  /** Rang de couleur de l'auteur — voir `lib/user-colors`. */
  authorColor: number;
  body: string;
  createdAt: number;
};

export type CommentWithAuthor = {
  id: string;
  videoId: string;
  userId: string;
  authorName: string;
  /** Rang de couleur de l'auteur — voir `lib/user-colors`. */
  authorColor: number;
  timecode: number;
  /** Fin de plage, ou `null` pour une note posée sur un instant unique. */
  timecodeEnd: number | null;
  /** JSON des formes dessinées, à lire avec `parseAnnotation`. */
  annotation: string | null;
  body: string;
  resolved: boolean;
  createdAt: number;
  /** Fil de discussion, dans l'ordre d'écriture. */
  replies: CommentReply[];
};

/**
 * Toutes les réponses d'une vidéo, en une requête plutôt qu'une par note :
 * à vingt notes ouvertes, la version naïve faisait vingt allers-retours pour
 * afficher un panneau.
 */
function listRepliesForVideo(videoId: string, colors: Map<string, number>) {
  const rows = db
    .select({
      id: commentReplies.id,
      commentId: commentReplies.commentId,
      userId: commentReplies.userId,
      authorName: users.name,
      body: commentReplies.body,
      createdAt: commentReplies.createdAt,
    })
    .from(commentReplies)
    .innerJoin(comments, eq(comments.id, commentReplies.commentId))
    .innerJoin(users, eq(users.id, commentReplies.userId))
    .where(eq(comments.videoId, videoId))
    .orderBy(asc(commentReplies.createdAt))
    .all();

  const byComment = new Map<string, CommentReply[]>();
  for (const row of rows) {
    const reply: CommentReply = { ...row, authorColor: colors.get(row.userId) ?? 0 };
    const bucket = byComment.get(row.commentId);
    if (bucket) bucket.push(reply);
    else byComment.set(row.commentId, [reply]);
  }
  return byComment;
}

/**
 * Triés par timecode : c'est l'ordre dans lequel un monteur reprend ses
 * notes, pas l'ordre où elles ont été écrites.
 */
export function listComments(videoId: string): CommentWithAuthor[] {
  const colors = userColorIndexes();
  const replies = listRepliesForVideo(videoId, colors);

  return db
    .select({
      id: comments.id,
      videoId: comments.videoId,
      userId: comments.userId,
      authorName: users.name,
      timecode: comments.timecode,
      timecodeEnd: comments.timecodeEnd,
      annotation: comments.annotation,
      body: comments.body,
      resolved: comments.resolved,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(eq(comments.videoId, videoId))
    .orderBy(asc(comments.timecode), asc(comments.createdAt))
    .all()
    .map((row) => ({
      ...row,
      authorColor: colors.get(row.userId) ?? 0,
      replies: replies.get(row.id) ?? [],
    }));
}

export function getComment(id: string) {
  return db.select().from(comments).where(eq(comments.id, id)).get() ?? null;
}

export function insertComment(input: {
  videoId: string;
  userId: string;
  timecode: number;
  timecodeEnd: number | null;
  annotation: string | null;
  body: string;
}) {
  const comment = {
    id: randomUUID(),
    ...input,
    resolved: false,
    createdAt: Date.now(),
  };
  db.insert(comments).values(comment).run();
  return comment;
}

export function updateCommentBody(id: string, body: string) {
  db.update(comments).set({ body }).where(eq(comments.id, id)).run();
}

export function setCommentResolved(id: string, resolved: boolean) {
  db.update(comments).set({ resolved }).where(eq(comments.id, id)).run();
}

export function deleteComment(id: string) {
  // Le `ON DELETE CASCADE` du DDL s'en charge déjà, mais il dépend du pragma
  // `foreign_keys`. On efface explicitement : une réponse orpheline ne
  // s'afficherait nulle part et resterait en base pour toujours.
  db.delete(commentReplies).where(eq(commentReplies.commentId, id)).run();
  db.delete(comments).where(eq(comments.id, id)).run();
}

export function getReply(id: string) {
  return db.select().from(commentReplies).where(eq(commentReplies.id, id)).get() ?? null;
}

export function insertReply(input: {
  commentId: string;
  userId: string;
  body: string;
}) {
  const reply = { id: randomUUID(), ...input, createdAt: Date.now() };
  db.insert(commentReplies).values(reply).run();
  return reply;
}

export function deleteReply(id: string) {
  db.delete(commentReplies).where(eq(commentReplies.id, id)).run();
}

export function normalizeBody(raw: string) {
  // On garde les retours à la ligne (une note de review est souvent une
  // liste), mais on retire les blancs en bord et les lignes vides en série.
  return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
