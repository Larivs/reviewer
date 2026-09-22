// Partagé client et serveur : pas de garde "server-only".

/**
 * Formes dessinées sur l'image. Les coordonnées sont **normalisées entre 0
 * et 1** par rapport au cadre de l'image, jamais en pixels : une annotation
 * posée en plein écran doit se retrouver au même endroit sur une fenêtre
 * réduite, et rester juste quelle que soit la définition de la vidéo.
 */
export type Shape =
  | { t: "pin"; x: number; y: number }
  | { t: "rect"; x: number; y: number; w: number; h: number }
  | { t: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { t: "free"; pts: [number, number][] };

export type Annotation = { shapes: Shape[] };

export const MAX_SHAPES = 40;
export const MAX_POINTS = 600;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function isFinitePair(a: unknown, b: unknown) {
  return typeof a === "number" && typeof b === "number" &&
    Number.isFinite(a) && Number.isFinite(b);
}

/**
 * Nettoie une annotation venue du navigateur. Elle sera stockée puis
 * réaffichée telle quelle : on ne fait confiance à aucun champ.
 * Renvoie `null` si rien d'exploitable n'en sort.
 */
export function sanitizeAnnotation(input: unknown): Annotation | null {
  if (!input || typeof input !== "object") return null;
  const raw = (input as { shapes?: unknown }).shapes;
  if (!Array.isArray(raw)) return null;

  const shapes: Shape[] = [];

  for (const item of raw.slice(0, MAX_SHAPES)) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;

    switch (s.t) {
      case "pin":
        if (!isFinitePair(s.x, s.y)) continue;
        shapes.push({ t: "pin", x: clamp01(s.x as number), y: clamp01(s.y as number) });
        break;

      case "rect": {
        if (!isFinitePair(s.x, s.y) || !isFinitePair(s.w, s.h)) continue;
        const x = clamp01(s.x as number);
        const y = clamp01(s.y as number);
        const w = clamp01(s.w as number);
        const h = clamp01(s.h as number);
        // Un rectangle d'un pixel est un clic manqué, pas une intention.
        if (w < 0.005 || h < 0.005) continue;
        shapes.push({ t: "rect", x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) });
        break;
      }

      case "arrow": {
        if (!isFinitePair(s.x1, s.y1) || !isFinitePair(s.x2, s.y2)) continue;
        const x1 = clamp01(s.x1 as number);
        const y1 = clamp01(s.y1 as number);
        const x2 = clamp01(s.x2 as number);
        const y2 = clamp01(s.y2 as number);
        if (Math.hypot(x2 - x1, y2 - y1) < 0.01) continue;
        shapes.push({ t: "arrow", x1, y1, x2, y2 });
        break;
      }

      case "free": {
        if (!Array.isArray(s.pts)) continue;
        const pts = s.pts
          .slice(0, MAX_POINTS)
          .filter((p): p is [number, number] => Array.isArray(p) && isFinitePair(p[0], p[1]))
          .map(([x, y]): [number, number] => [clamp01(x), clamp01(y)]);
        if (pts.length < 2) continue;
        shapes.push({ t: "free", pts });
        break;
      }

      default:
        continue;
    }
  }

  return shapes.length > 0 ? { shapes } : null;
}

/** Lit une annotation stockée en base. Tolère le JSON abîmé. */
export function parseAnnotation(raw: string | null): Annotation | null {
  if (!raw) return null;
  try {
    return sanitizeAnnotation(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serializeAnnotation(annotation: Annotation | null): string | null {
  if (!annotation || annotation.shapes.length === 0) return null;
  return JSON.stringify(annotation);
}

/** Libellé court pour signaler une annotation dans la liste des notes. */
export function describeAnnotation(annotation: Annotation): string {
  const counts = new Map<Shape["t"], number>();
  for (const shape of annotation.shapes)
    counts.set(shape.t, (counts.get(shape.t) ?? 0) + 1);

  const noms: Record<Shape["t"], string> = {
    pin: "point",
    rect: "cadre",
    arrow: "flèche",
    free: "tracé",
  };

  return [...counts.entries()]
    .map(([t, n]) => (n > 1 ? `${n} ${noms[t]}s` : noms[t]))
    .join(", ");
}
