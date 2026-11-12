import "server-only";

/**
 * Notification sortante, optionnelle : `REVIEWER_WEBHOOK_URL` dans
 * `.env.local`. Rien n'est envoyé tant que la variable est vide.
 *
 * Le corps porte à la fois `text` et `content` : Slack lit le premier,
 * Discord le second, et un outil maison prend les champs structurés. Un seul
 * format pour les trois plutôt qu'un réglage de plus.
 *
 * Jamais bloquant, jamais bruyant : la note est déjà enregistrée, un webhook
 * injoignable ne doit ni la retarder ni afficher une erreur à son auteur.
 */
const URL_ = process.env.REVIEWER_WEBHOOK_URL?.trim();
/** Adresse publique de l'instance, pour que le message porte un lien. */
const PUBLIC = process.env.REVIEWER_PUBLIC_URL?.trim().replace(/\/+$/, "");

export type WebhookEvent = {
  type: "note" | "reponse" | "statut" | "version";
  video: { id: string; name: string };
  author: string;
  /** Phrase lisible, telle qu'elle s'affichera dans le salon. */
  summary: string;
  body?: string;
};

export function sendWebhook(event: WebhookEvent) {
  if (!URL_) return;

  const link = PUBLIC ? `${PUBLIC}/v/${event.video.id}` : null;
  const text = [event.summary, event.body, link].filter(Boolean).join("\n");

  void fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content: text, ...event, url: link }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
