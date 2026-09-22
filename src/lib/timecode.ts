// Utilisé côté client : pas de garde "server-only".

/** Cadence de repli quand ffprobe n'a rien pu déterminer. */
export const FALLBACK_FPS = 25;

/**
 * Numéro de l'image affichée à cet instant. Le petit epsilon compense les
 * erreurs d'arrondi des flottants : sans lui, un `currentTime` de 0.9999999
 * pour une image censée commencer à 1.0 renvoie l'image précédente.
 */
export function frameAt(time: number, fps: number) {
  return Math.max(0, Math.floor(time * fps + 1e-6));
}

/**
 * Instant où viser pour afficher une image donnée. On cible le *milieu* de
 * l'image : viser sa frontière exacte fait souvent atterrir sur la
 * précédente, à cause de la précision des seeks.
 */
export function timeOfFrame(frame: number, fps: number) {
  return Math.max(0, (frame + 0.5) / fps);
}

function split(total: number) {
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: Math.floor(total % 60),
  };
}

const pad = (n: number, width = 2) => String(Math.floor(n)).padStart(width, "0");

/**
 * `HH:MM:SS:FF` — la notation des logiciels de montage, celle que Hugo et
 * Jérôme liront dans leur timeline. Sans cadence connue, on retombe sur des
 * centièmes plutôt que d'inventer un numéro d'image.
 */
export function formatTimecode(time: number, fps: number | null): string {
  if (!Number.isFinite(time) || time < 0) time = 0;
  const { h, m, s } = split(time);

  if (!fps) {
    const cs = Math.floor((time % 1) * 100);
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
  }

  // Position dans la seconde courante, et non l'index absolu modulo la
  // cadence : ce dernier dérive dès que la cadence n'est pas entière
  // (23,976 fps afficherait « :23 » à 10 s pile).
  const frameInSecond = Math.floor((time % 1) * fps + 1e-6);
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frameInSecond)}`;
}

/** Version courte pour les listes : `1:04` ou `1:02:03`. */
export function formatClock(time: number): string {
  if (!Number.isFinite(time) || time < 0) return "0:00";
  const { h, m, s } = split(time);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Durée d'un intervalle, pour dire de combien il court. Sous la minute on
 * garde le dixième de seconde : une plage de review fait souvent deux ou
 * trois secondes, et « 0:02 » ne permet plus de distinguer deux essais.
 */
export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  if (seconds < 60) return `${seconds.toFixed(1).replace(".", ",")} s`;
  return formatClock(seconds);
}
