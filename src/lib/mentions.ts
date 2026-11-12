// Partagé client et serveur, aucune dépendance : testé dans `tests/`.

/** Lettre, chiffre ou tiret bas : ce qui prolonge un mot. */
const WORD = /[\p{L}\p{N}_]/u;

type Span = { start: number; end: number; name: string };

/**
 * Repère les `@Prénom` d'un texte, parmi des noms connus.
 *
 * Les noms ne sont pas des mots simples : « Jean-Paul », « Marie (2) »
 * existent, et un invité peut s'appeler « Toma (2) » à côté de « Toma ». On
 * ne découpe donc pas le texte sur les espaces : à chaque `@`, on cherche le
 * **plus long** nom connu qui commence là. Sans cette règle, « @Toma (2) »
 * prévenait Toma.
 *
 * Un `@` collé à un mot n'est pas une mention (une adresse de courriel), ni
 * un nom suivi d'une lettre (« @Tomate » ne désigne pas Toma).
 */
function scan(body: string, names: string[]): Span[] {
  const byLength = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  const lower = body.toLowerCase();
  const spans: Span[] = [];

  for (let at = lower.indexOf("@"); at !== -1; at = lower.indexOf("@", at + 1)) {
    if (at > 0 && WORD.test(body[at - 1])) continue;
    for (const name of byLength) {
      const end = at + 1 + name.length;
      if (lower.slice(at + 1, end) !== name.toLowerCase()) continue;
      if (end < body.length && WORD.test(body[end])) continue;
      spans.push({ start: at, end, name });
      break;
    }
  }
  return spans;
}

/** Les personnes mentionnées, une fois chacune, sous leur nom exact. */
export function findMentions(body: string, names: string[]): string[] {
  return [...new Set(scan(body, names).map((s) => s.name))];
}

/** Le texte découpé en morceaux, mentions à part, pour l'affichage. */
export function splitMentions(body: string, names: string[]) {
  const parts: { text: string; mention: boolean }[] = [];
  let cursor = 0;
  for (const span of scan(body, names)) {
    if (span.start > cursor) parts.push({ text: body.slice(cursor, span.start), mention: false });
    parts.push({ text: body.slice(span.start, span.end), mention: true });
    cursor = span.end;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), mention: false });
  return parts;
}
