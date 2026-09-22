import "server-only";

/**
 * Anti-force-brute minimaliste, en mémoire. Suffisant pour une app privée :
 * le compteur repart à zéro au redémarrage du serveur, ce qui n'a pas
 * d'importance à trois utilisateurs sur un réseau fermé.
 */
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

type Entry = { count: number; firstAt: number };
const attempts = new Map<string, Entry>();

export function isLockedOut(key: string) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailure(key: string) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

export function clearFailures(key: string) {
  attempts.delete(key);
}
