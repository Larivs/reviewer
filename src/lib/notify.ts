import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { commentReplies, comments, users } from "@/db/schema";
import { findMentions } from "./mentions";
import { sendWebhook, type WebhookEvent } from "./webhook";

/**
 * Prévenir les gens : le webhook du salon, et un courriel à qui a donné une
 * adresse. Tout est optionnel, rien ne part tant que rien n'est réglé dans
 * `.env.local`, et rien ici ne bloque ni ne fait échouer l'écriture d'une
 * note : elle est déjà enregistrée quand on arrive.
 *
 * `REVIEWER_SMTP_URL` est une adresse de connexion SMTP complète, par exemple
 * `smtps://utilisateur:motdepasse@smtp.exemple.fr:465`.
 */
const SMTP = process.env.REVIEWER_SMTP_URL?.trim();
const FROM = process.env.REVIEWER_MAIL_FROM?.trim() || "Reviewer <reviewer@localhost>";
const PUBLIC = process.env.REVIEWER_PUBLIC_URL?.trim().replace(/\/+$/, "");

/** Un seul transport pour tout le processus, ouvert au premier envoi. */
let transport: Transporter | null = null;

function mail(to: string, subject: string, text: string) {
  if (!SMTP) return;
  transport ??= nodemailer.createTransport(SMTP);
  // Un message par destinataire : personne ne lit l'adresse des autres.
  void transport.sendMail({ from: FROM, to, subject, text }).catch(() => {});
}

/** Tous les noms de comptes, pour reconnaître les mentions. */
export function allNames() {
  return db.select({ name: users.name }).from(users).all().map((u) => u.name);
}

/**
 * Une note ou une réponse vient d'être écrite.
 *
 * Reçoivent un courriel, s'ils ont une adresse et ne sont pas l'auteur :
 * - le **studio** (admins et membres), qui suit toutes les reviews ;
 * - les personnes **mentionnées**, à condition qu'elles aient déjà pris part
 *   à la review de cette vidéo. Sans cette condition, mentionner un client
 *   lui enverrait le nom et le contenu d'un projet qui n'est pas le sien.
 */
export function notifyNote(
  event: WebhookEvent & { body: string },
  authorId: string,
  /** Note interne : aucun invité n'est prévenu, même mentionné. */
  internal = false,
) {
  const mentioned = findMentions(event.body, allNames());
  sendWebhook(
    mentioned.length > 0
      ? { ...event, summary: `${event.summary} (pour ${mentioned.join(", ")})` }
      : event,
  );
  if (!SMTP) return;

  const involved = new Set([
    ...db
      .select({ id: comments.userId })
      .from(comments)
      .where(eq(comments.videoId, event.video.id))
      .all()
      .map((r) => r.id),
    ...db
      .select({ id: commentReplies.userId })
      .from(commentReplies)
      .innerJoin(comments, eq(comments.id, commentReplies.commentId))
      .where(eq(comments.videoId, event.video.id))
      .all()
      .map((r) => r.id),
  ]);

  const link = PUBLIC ? `\n\n${PUBLIC}/v/${event.video.id}` : "";
  for (const user of db.select().from(users).where(isNotNull(users.email)).all()) {
    if (!user.email || user.id === authorId) continue;
    const isMentioned = mentioned.includes(user.name);
    const staff = user.role !== "invite";
    if (!staff && (internal || !(isMentioned && involved.has(user.id)))) continue;

    mail(
      user.email,
      isMentioned
        ? `${event.author} te mentionne sur « ${event.video.name} »`
        : `Nouvelle note sur « ${event.video.name} »`,
      `${event.summary}\n\n${event.body}${link}`,
    );
  }
}
