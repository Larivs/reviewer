// Aucune dépendance : pur calcul, testé isolément dans `tests/`.

/**
 * Lit un en-tête `Range` pour un fichier de `size` octets.
 * `bytes=0-1023`, `bytes=500-` ou `bytes=-500` (derniers octets).
 * `null` pour tout ce qui n'est pas servable : la route répond alors 416.
 */
export function parseRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size)
    return null;

  return { start, end };
}
