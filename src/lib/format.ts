// Utilisé côté client comme côté serveur : pas de garde "server-only" ici.
import type { VideoStatus } from "@/db/schema";

/** `1:04` ou `1:02:03` selon la durée. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";

  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Fuseau et langue d'affichage des dates.
 *
 * Le fuseau doit être **explicite**. Sans lui, le rendu serveur utilise celui
 * de la machine et le navigateur celui du visiteur : deux valeurs différentes
 * pour la même date, et React signale une incohérence d'hydratation.
 *
 * Le préfixe `NEXT_PUBLIC_` n'est pas décoratif — il fait remplacer la valeur
 * à la compilation, des deux côtés. Une variable serveur ordinaire vaudrait
 * `undefined` dans le navigateur, et on retomberait exactement sur le
 * problème qu'on cherche à éviter.
 *
 * Europe/Paris par défaut, parce qu'il faut bien une valeur et que c'est
 * celle de l'équipe d'origine. Toute instance peut la changer.
 */
const TIMEZONE = process.env.NEXT_PUBLIC_REVIEWER_TIMEZONE || "Europe/Paris";
const LOCALE = process.env.NEXT_PUBLIC_REVIEWER_LOCALE || "fr-FR";

const DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(timestamp: number) {
  return DATE_FORMAT.format(new Date(timestamp));
}

export const STATUS_LABELS: Record<VideoStatus, string> = {
  a_review: "À review",
  en_cours: "En cours",
  modifs_demandees: "Modifs demandées",
  valide: "Validé",
};

/** Classes Tailwind par statut, pour garder une seule source de vérité. */
export const STATUS_CLASSES: Record<VideoStatus, string> = {
  a_review: "border-status-todo/40 bg-status-todo/10 text-status-todo",
  en_cours: "border-status-doing/40 bg-status-doing/10 text-status-doing",
  modifs_demandees: "border-status-changes/40 bg-status-changes/10 text-status-changes",
  valide: "border-status-done/40 bg-status-done/10 text-status-done",
};

/**
 * `22/09 10:18` — la même date, en deux fois moins de place.
 *
 * Dans une carte de note, la date pesait 111 px sur les 300 de la ligne : plus
 * que le timecode, et pour l'information dont on se sert le moins. La forme
 * longue reste accessible en infobulle via `formatDateTime`.
 *
 * Aucune notion de « aujourd'hui » : un libellé relatif dépendrait de
 * l'instant du rendu, donc du serveur puis du navigateur — soit une
 * incohérence d'hydratation garantie un jour à minuit.
 */
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatShortDateTime(timestamp: number) {
  return SHORT_DATE_FORMAT.format(new Date(timestamp)).replace(", ", " ");
}
