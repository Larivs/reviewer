// Pas de garde "server-only" et surtout **aucune dépendance** : ce module est
// importé à la fois par la couche d'accès et par les lectures de données, et
// c'est justement ce qui évite un cycle entre les deux.

/**
 * Ce qu'un spectateur a le droit de voir.
 *
 * - `roots` : les projets ouverts à un invité, tels quels. C'est sa racine à
 *   lui, il n'a pas à savoir qu'ils vivent au milieu d'autres.
 * - `visible` : ces projets **et toute leur descendance**, pour trancher en
 *   une consultation d'ensemble plutôt qu'en remontant l'arbre à chaque fois.
 *
 * `null` veut dire « aucune restriction » : c'est le cas d'un admin ou d'un
 * membre, et il est distinct d'un ensemble vide, qui veut dire « un invité à
 * qui on n'a encore rien ouvert ». Confondre les deux ouvrirait tout l'espace
 * au compte le moins doté, d'où le type, et non un simple tableau.
 */
export type Scope = {
  roots: string[];
  visible: Set<string>;
  /**
   * Vidéos ouvertes **une à une**, hors de tout dossier visible. C'est ce
   * que produit un lien qui ne partage qu'un montage : la vidéo se voit,
   * le projet qui la contient reste fermé.
   */
  videos: Set<string>;
} | null;

/** Un dossier est-il dans la portée ? `null` désigne la racine de l'espace. */
export function scopeAllowsFolder(scope: Scope, folderId: string | null) {
  if (scope === null) return true;
  // La racine appartient à l'espace, pas à un projet : un invité n'y a rien
  // à faire, il entre directement dans les projets qu'on lui a ouverts.
  if (folderId === null) return false;
  return scope.visible.has(folderId);
}

/**
 * Une vidéo est atteignable de deux façons : par son dossier, ou parce
 * qu'elle a été partagée seule. Les deux chemins comptent, c'est la seule
 * fonction qui doit être consultée avant de servir une vidéo.
 */
export function scopeAllowsVideo(
  scope: Scope,
  video: { id: string; folderId: string | null },
) {
  if (scope === null) return true;
  return scope.videos.has(video.id) || scopeAllowsFolder(scope, video.folderId);
}
