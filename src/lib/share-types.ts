// Aucune garde "server-only" et **aucune dépendance** : ce module est importé
// par le bouton de partage, qui tourne dans le navigateur.
//
// La leçon vient d'une erreur : `share-button` importait `lib/share`, marqué
// `server-only`, et entraînait donc SQLite entier dans le paquet client.
// `tsc` ne voit rien — c'est une contrainte du bundler, pas du typage. Même
// remède que pour `scope.ts` : ce qui est partagé entre les deux mondes vit
// dans un fichier qui ne dépend de rien.

/** Durées proposées à la création d'un lien. `days: null` = sans expiration. */
export const LINK_DURATIONS = [
  { key: "7", label: "7 jours", days: 7 },
  { key: "30", label: "30 jours", days: 30 },
  { key: "90", label: "90 jours", days: 90 },
  { key: "never", label: "Sans expiration", days: null },
] as const;

export type LinkDuration = (typeof LINK_DURATIONS)[number]["key"];

/** Ce qu'un lien ouvre : un projet entier, ou un seul montage. */
export type ShareTarget =
  | { kind: "folder"; id: string }
  | { kind: "video"; id: string };
