import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { commentReplies, comments, users } from "@/db/schema";
import { userColorIndexes } from "./users";
import { findMentions } from "./mentions";

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
  /** Rang de couleur de l'auteur, voir `lib/user-colors`. */
  authorColor: number;
  body: string;
  /** Noms mentionnés par `@`, reconnus côté serveur parmi les comptes. */
  mentions: string[];
  createdAt: number;
};

export type CommentWithAuthor = {
  id: string;
  videoId: string;
  userId: string;
  authorName: string;
  /** Rang de couleur de l'auteur, voir `lib/user-colors`. */
  authorColor: number;
  timecode: number;
  /** Fin de plage, ou `null` pour une note posée sur un instant unique. */
  timecodeEnd: number | null;
  /** JSON des formes dessinées, à lire avec `parseAnnotation`. */
  annotation: string | null;
  body: string;
  /** Noms mentionnés par `@`, reconnus côté serveur parmi les comptes. */
  mentions: string[];
  /** Note interne, que les invités ne reçoivent pas. */
  internal: boolean;
  /**
   * Rang dans l'ordre du timecode, sur la liste **entière**. Calculé ici et
   * pas dans le navigateur : un invité ne reçoit pas les notes internes, et
   * numéroter ce qu'il reçoit ferait de « la note 3 » une note différente
   * pour lui et pour le studio. Il voit donc des trous dans la numérotation,
   * ce qui vaut mieux que deux personnes qui ne parlent plus de la même.
   */
  number: number;
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
function listRepliesForVideo(
  videoId: string,
  colors: Map<string, number>,
  names: string[],
) {
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
    const reply: CommentReply = {
      ...row,
      authorColor: colors.get(row.userId) ?? 0,
      mentions: findMentions(row.body, names),
    };
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
export function listComments(
  videoId: string,
  { includeInternal }: { includeInternal: boolean },
): CommentWithAuthor[] {
  const colors = userColorIndexes();
  // Les mentions sont reconnues ici, pas dans le navigateur : il faudrait
  // sinon lui envoyer la liste de tous les comptes, invités des autres
  // clients compris. Il ne reçoit que les noms effectivement cités.
  const names = db.select({ name: users.name }).from(users).all().map((u) => u.name);
  const replies = listRepliesForVideo(videoId, colors, names);

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
      internal: comments.internal,
      resolved: comments.resolved,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(eq(comments.videoId, videoId))
    .orderBy(asc(comments.timecode), asc(comments.createdAt))
    .all()
    .map((row, i) => ({
      ...row,
      number: i + 1,
      authorColor: colors.get(row.userId) ?? 0,
      mentions: findMentions(row.body, names),
      replies: replies.get(row.id) ?? [],
    }))
    // Après la numérotation, pour qu'elle porte sur la liste entière.
    .filter((note) => includeInternal || !note.internal);
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
  internal: boolean;
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

/** Nombre de notes encore ouvertes sur une vidéo. */
export function countOpenComments(videoId: string) {
  return db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.videoId, videoId), eq(comments.resolved, false)))
    .all().length;
}

/**
 * Reporte les notes **ouvertes** d'une version sur la suivante.
 *
 * Ce n'est pas automatique, et c'est voulu : une note résolue n'a rien à
 * faire sur la version qui la corrige, et une note ouverte n'y a sa place que
 * si le monteur ne l'a pas traitée. C'est donc un geste, qu'on fait après
 * avoir regardé la nouvelle version.
 *
 * Chaque note garde son auteur, son timecode et son dessin. Le timecode est
 * borné à la nouvelle durée, un montage raccourci ne doit pas laisser une
 * note au-delà de sa fin. Relancer le geste ne duplique rien : une note déjà
 * présente (même auteur, même timecode, même texte) est sautée.
 */
export function carryOpenComments(fromVideoId: string, toVideoId: string, duration: number | null) {
  return db.transaction((tx) => {
    const open = tx
      .select()
      .from(comments)
      .where(and(eq(comments.videoId, fromVideoId), eq(comments.resolved, false)))
      .all();
    const existing = new Set(
      tx
        .select()
        .from(comments)
        .where(eq(comments.videoId, toVideoId))
        .all()
        .map((c) => `${c.userId}|${c.timecode}|${c.body}`),
    );
    const clamp = (t: number) => (duration === null ? t : Math.min(t, duration));

    let carried = 0;
    for (const note of open) {
      const timecode = clamp(note.timecode);
      if (existing.has(`${note.userId}|${timecode}|${note.body}`)) continue;
      const end = note.timecodeEnd === null ? null : clamp(note.timecodeEnd);
      tx.insert(comments)
        .values({
          id: randomUUID(),
          videoId: toVideoId,
          userId: note.userId,
          timecode,
          timecodeEnd: end !== null && end > timecode + 0.01 ? end : null,
          annotation: note.annotation,
          body: note.body,
          internal: note.internal,
          resolved: false,
          createdAt: Date.now(),
        })
        .run();
      carried += 1;
    }
    return carried;
  });
}
