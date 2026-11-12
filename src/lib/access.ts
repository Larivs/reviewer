import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  folderGrants,
  folders,
  shareLinks,
  users,
  videoGrants,
  videos,
  type UserRole,
} from "@/db/schema";
import { getCurrentUser, type CurrentUser } from "./auth";
import { getVideo, type Video } from "./videos";
import { scopeAllowsFolder, scopeAllowsVideo, type Scope } from "./scope";

export { scopeAllowsFolder, scopeAllowsVideo, type Scope };

/**
 * Qui regarde, et jusqu'où.
 *
 * Avant les rôles, l'app n'avait qu'une seule règle : « il y a une session →
 * tu vois tout ». Elle tenait tant que les trois comptes partageaient le même
 * studio. Elle ne tient plus dès qu'un client de Jérôme se connecte : il ne
 * doit pas voir les projets d'un autre client, et deviner une URL ne doit pas
 * suffire à ouvrir une vidéo.
 *
 * Tout passe donc par ce fichier, et les routes ne lisent plus la base
 * directement. C'est un choix de forme autant que de fond : une règle
 * d'accès dispersée dans vingt-deux fichiers est une règle qu'on oublie
 * d'appliquer au vingt-troisième.
 */

export type Viewer = CurrentUser & { role: UserRole };

/**
 * `cache` : plusieurs composants d'un même rendu demandent le spectateur -
 * la page, l'en-tête, la grille. Sans ça on relirait la session et la table
 * des comptes à chaque appel.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const row = db
    .select({ role: users.role, invitedVia: users.invitedVia })
    .from(users)
    .where(eq(users.id, user.id))
    .get();

  // Compte effacé entre la création de la session et maintenant : on ne
  // suppose pas de rôle, on refuse.
  if (!row) return null;

  // Le compte est né d'un lien de partage : son accès ne vaut que tant que le
  // lien vit. Sans ce contrôle, l'expiration serait décorative, le cookie de
  // session dure trente jours et survivrait largement au lien.
  if (row.invitedVia && !linkIsLive(row.invitedVia)) return null;

  return { ...user, role: row.role };
});

/** Le lien existe-t-il encore, et n'a-t-il pas expiré ? */
function linkIsLive(linkId: string) {
  const link = db
    .select({ expiresAt: shareLinks.expiresAt })
    .from(shareLinks)
    .where(eq(shareLinks.id, linkId))
    .get();
  if (!link) return false; // supprimé = révoqué
  return link.expiresAt === null || link.expiresAt > Date.now();
}

/**
 * Un invité dont le lien est mort n'est pas « déconnecté » au sens habituel :
 * l'envoyer vers l'écran de connexion lui présenterait un formulaire qu'il ne
 * peut pas remplir, il n'a jamais eu de mot de passe. On le renvoie vers une
 * page qui le lui dit.
 */
async function expiredGuest() {
  const user = await getCurrentUser();
  if (!user) return false;
  const row = db
    .select({ invitedVia: users.invitedVia })
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  return Boolean(row?.invitedVia && !linkIsLive(row.invitedVia));
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer) return viewer;
  redirect((await expiredGuest()) ? "/lien-expire" : "/login");
}

export const isAdmin = (v: Viewer) => v.role === "admin";
/** Admin ou membre : les comptes qui voient et rangent tout l'espace. */
export const isStaff = (v: Viewer) => v.role === "admin" || v.role === "membre";
export const isGuest = (v: Viewer) => v.role === "invite";

/**
 * Portée d'un spectateur. Pour un invité, on part de ses projets et on
 * descend : la table des dossiers tient en mémoire, quelques dizaines de
 * lignes, donc on la lit une fois et on parcourt, plutôt que d'enchaîner une
 * requête récursive par vérification.
 *
 * La profondeur est bornée : un cycle parent/enfant en base ferait tourner
 * cette boucle indéfiniment, et une donnée abîmée ne doit pas figer un rendu.
 */
export const getScope = cache(async (): Promise<Scope> => {
  const viewer = await requireViewer();
  if (!isGuest(viewer)) return null;

  // Un droit ouvert par un lien meurt avec lui. La suppression du lien
  // emporte la ligne ; l'expiration, elle, ne supprime rien, d'où ce filtre
  // à chaque lecture plutôt qu'un ménage qu'il faudrait penser à lancer.
  const now = Date.now();
  const live = (g: { linkId: string | null; linkExists: string | null; expiresAt: number | null }) =>
    g.linkId === null ||
    (g.linkExists !== null && (g.expiresAt === null || g.expiresAt > now));

  const roots = db
    .select({
      folderId: folderGrants.folderId,
      linkId: folderGrants.linkId,
      linkExists: shareLinks.id,
      expiresAt: shareLinks.expiresAt,
    })
    .from(folderGrants)
    .leftJoin(shareLinks, eq(shareLinks.id, folderGrants.linkId))
    .where(eq(folderGrants.userId, viewer.id))
    .all()
    .filter(live)
    .map((r) => r.folderId);

  // Vidéos ouvertes seules, par un lien qui ne partageait qu'un montage.
  const grantedVideos = new Set(
    db
      .select({
        videoId: videoGrants.videoId,
        linkId: videoGrants.linkId,
        linkExists: shareLinks.id,
        expiresAt: shareLinks.expiresAt,
      })
      .from(videoGrants)
      .leftJoin(shareLinks, eq(shareLinks.id, videoGrants.linkId))
      .where(eq(videoGrants.userId, viewer.id))
      .all()
      .filter(live)
      .map((r) => r.videoId),
  );

  // Un montage partagé seul l'est avec toutes ses versions : le client doit
  // voir la v3 déposée après l'envoi du lien, c'est même pour ça qu'on la
  // dépose. Le droit reste posé sur une ligne, la pile s'en déduit ici.
  if (grantedVideos.size > 0) {
    const stacked = db
      .select({ id: videos.id, stackId: videos.stackId })
      .from(videos)
      .all()
      .filter((v) => v.stackId !== null);
    const stacks = new Set(
      stacked.filter((v) => grantedVideos.has(v.id)).map((v) => v.stackId),
    );
    for (const v of stacked) if (stacks.has(v.stackId)) grantedVideos.add(v.id);
  }

  if (roots.length === 0)
    return { roots: [], visible: new Set(), videos: grantedVideos };

  const all = db
    .select({ id: folders.id, parentId: folders.parentId })
    .from(folders)
    .all();

  const children = new Map<string, string[]>();
  for (const f of all) {
    if (!f.parentId) continue;
    const list = children.get(f.parentId);
    if (list) list.push(f.id);
    else children.set(f.parentId, [f.id]);
  }

  // Un projet accordé puis supprimé laisse un droit qui ne pointe nulle
  // part : on ne le garde pas dans `roots`, sinon il s'afficherait comme un
  // dossier fantôme sur la page d'accueil de l'invité.
  const known = new Set(all.map((f) => f.id));
  const liveRoots = roots.filter((id) => known.has(id));

  const visible = new Set<string>();
  const queue = [...liveRoots];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (visible.has(id)) continue;
    visible.add(id);
    for (const child of children.get(id) ?? []) queue.push(child);
  }

  return { roots: liveRoots, visible, videos: grantedVideos };
});

/**
 * Le dossier demandé, ou `notFound()`.
 *
 * Volontairement un 404 et non un 403 : dire « interdit » confirmerait
 * l'existence du projet à quelqu'un qui n'a pas à savoir qu'il existe.
 */
export async function requireFolderView(folderId: string) {
  const viewer = await requireViewer();
  const scope = await getScope();
  if (!scopeAllowsFolder(scope, folderId)) notFound();
  return { viewer, scope };
}

/** La vidéo demandée, ou `notFound()`, même raisonnement que ci-dessus. */
export async function requireVideoView(
  videoId: string,
): Promise<{ viewer: Viewer; scope: Scope; video: Video }> {
  const viewer = await requireViewer();
  const scope = await getScope();
  const video = getVideo(videoId);
  if (!video) notFound();
  if (!scopeAllowsVideo(scope, video)) notFound();
  return { viewer, scope, video };
}

/**
 * Version pour les routes API, qui doivent rendre un statut et non une page.
 * Même politique : 404 plutôt que 403, et jamais de détail sur la raison.
 */
export async function readVideoOr404(
  videoId: string,
): Promise<{ viewer: Viewer; video: Video } | Response> {
  const viewer = await getViewer();
  if (!viewer) return new Response("Non autorisé", { status: 401 });

  const video = getVideo(videoId);
  if (!video) return new Response("Introuvable", { status: 404 });

  const scope = await getScope();
  if (!scopeAllowsVideo(scope, video))
    return new Response("Introuvable", { status: 404 });

  return { viewer, video };
}

/**
 * Variante non lançante de `requireVideoView`, pour les actions serveur.
 *
 * Une action doit rendre un message que l'interface affiche dans la carte,
 * pas une page 404 : `notFound()` au milieu d'une action remplacerait tout
 * l'écran alors qu'on vient seulement de cliquer sur « résolu ».
 */
export async function requireVideoAccess(
  videoId: string,
): Promise<{ viewer: Viewer; video: Video } | null> {
  const viewer = await getViewer();
  if (!viewer) return null;

  const video = getVideo(videoId);
  if (!video) return null;

  const scope = await getScope();
  if (!scopeAllowsVideo(scope, video)) return null;

  return { viewer, video };
}

/** Ce que renvoient les actions serveur quand le rôle ne suffit pas. */
export const FORBIDDEN = {
  ok: false as const,
  error: "Ton compte n'a pas les droits pour ça.",
};

/**
 * Déposer, créer et ranger des dossiers, renommer, supprimer : le travail de
 * rangement de l'espace, réservé au studio. Un invité commente, il
 * n'administre pas la bibliothèque de quelqu'un d'autre.
 */
export async function requireStaff(): Promise<Viewer | null> {
  const viewer = await requireViewer();
  return isStaff(viewer) ? viewer : null;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!isAdmin(viewer)) notFound();
  return viewer;
}

/** Les comptes de l'espace, pour la page d'administration. */
export type Account = {
  id: string;
  name: string;
  role: UserRole;
  createdAt: number;
  /** Projets ouverts à ce compte. Vide pour un admin ou un membre. */
  grants: { id: string; name: string }[];
};

export function listAccounts(): Account[] {
  const rows = db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id))
    .all();

  const grants = db
    .select({
      userId: folderGrants.userId,
      id: folders.id,
      name: folders.name,
    })
    .from(folderGrants)
    .innerJoin(folders, eq(folders.id, folderGrants.folderId))
    // Seulement les droits posés à la main : ceux d'un lien se gèrent par
    // le lien, dans la liste des liens actifs.
    .where(isNull(folderGrants.linkId))
    .orderBy(asc(folders.name))
    .all();

  const byUser = new Map<string, { id: string; name: string }[]>();
  for (const g of grants) {
    const list = byUser.get(g.userId);
    if (list) list.push({ id: g.id, name: g.name });
    else byUser.set(g.userId, [{ id: g.id, name: g.name }]);
  }

  return rows.map((row) => ({ ...row, grants: byUser.get(row.id) ?? [] }));
}

/**
 * Pose les droits manuels d'un compte. Ne touche pas à ceux qu'un lien a
 * ouverts : décocher un projet ici ne doit pas fermer un lien, et l'inverse.
 * Cocher un projet déjà ouvert par un lien le rend permanent, c'est bien ce
 * que l'admin vient de demander.
 */
export function setGrants(userId: string, folderIds: string[]) {
  // On ne garde que des dossiers qui existent : un identifiant venu du
  // navigateur ne doit pas créer une ligne qui ne pointe nulle part.
  const known = new Set(db.select({ id: folders.id }).from(folders).all().map((f) => f.id));
  const wanted = [...new Set(folderIds)].filter((id) => known.has(id));
  const now = Date.now();

  db.transaction((tx) => {
    tx.delete(folderGrants)
      .where(
        and(
          eq(folderGrants.userId, userId),
          isNull(folderGrants.linkId),
          notInArray(folderGrants.folderId, wanted),
        ),
      )
      .run();
    if (wanted.length === 0) return;
    tx.insert(folderGrants)
      .values(wanted.map((folderId) => ({ userId, folderId, linkId: null, createdAt: now })))
      .onConflictDoUpdate({
        target: [folderGrants.userId, folderGrants.folderId],
        set: { linkId: null },
      })
      .run();
  });
}

export function setRole(userId: string, role: UserRole) {
  db.transaction((tx) => {
    tx.update(users).set({ role }).where(eq(users.id, userId)).run();
    // Un compte qui repasse au studio voit tout : ses droits par projet n'ont
    // plus de sens et resteraient à se réappliquer en silence s'il redevenait
    // invité un jour.
    if (role !== "invite") {
      tx.delete(folderGrants).where(eq(folderGrants.userId, userId)).run();
      tx.delete(videoGrants).where(eq(videoGrants.userId, userId)).run();
    }
  });
}

/** Nombre d'administrateurs, pour ne pas laisser l'espace sans gardien. */
export function countAdmins() {
  return db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).all().length;
}
