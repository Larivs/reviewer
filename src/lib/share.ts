import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  folderGrants,
  folders,
  sessions,
  shareLinks,
  users,
  videoGrants,
  videos,
} from "@/db/schema";
import { generatePassword } from "./auth";
import { LINK_DURATIONS, type LinkDuration, type ShareTarget } from "./share-types";

// Reexport pour le serveur : les appelants cote serveur n'ont pas a savoir
// que ces valeurs vivent dans un fichier separe pour le navigateur.
export { LINK_DURATIONS };
export type { LinkDuration, ShareTarget };

/**
 * Liens de partage : une adresse qu'on transmet, et qui ouvre un projet ou
 * une vidéo à qui l'a.
 *
 * Le parti pris est la friction zéro. Le client ne crée pas de compte, ne
 * choisit pas de mot de passe, n'en reçoit pas : il clique, donne son
 * prénom, commente. L'app lui fabrique une identité d'invité pour que ses
 * notes soient signées, sans auteur, une review à plusieurs devient
 * illisible.
 *
 * La contrepartie est assumée : **qui détient le lien entre**. Le garde-fou
 * est l'expiration, vérifiée à chaque rendu et pas seulement à l'ouverture
 * du lien.
 */

/**
 * Jeton de l'URL. 95 bits tirés au hasard : il n'est pas deviné, et c'est
 * la seule chose qui protège l'accès. Même tirage et même alphabet que les
 * mots de passe générés, on écarte ce qui se lit mal si quelqu'un le recopie
 * à la main depuis un message.
 */
const makeToken = generatePassword;

export function createShareLink(
  target: ShareTarget,
  duration: LinkDuration,
  createdBy: string,
) {
  const days = LINK_DURATIONS.find((d) => d.key === duration)?.days ?? null;

  const link = {
    id: randomUUID(),
    token: makeToken(),
    folderId: target.kind === "folder" ? target.id : null,
    videoId: target.kind === "video" ? target.id : null,
    expiresAt: days === null ? null : Date.now() + days * 24 * 60 * 60 * 1000,
    createdBy,
    createdAt: Date.now(),
  };
  db.insert(shareLinks).values(link).run();
  return link;
}

export type ShareLink = typeof shareLinks.$inferSelect;

export function getLinkByToken(token: string) {
  return db.select().from(shareLinks).where(eq(shareLinks.token, token)).get() ?? null;
}

export function linkIsExpired(link: ShareLink) {
  return link.expiresAt !== null && link.expiresAt <= Date.now();
}

/** Ce que le lien ouvre, pour l'annoncer au client avant qu'il entre. */
export function describeLink(link: ShareLink): string | null {
  if (link.videoId) {
    const video = db
      .select({ name: videos.name })
      .from(videos)
      .where(eq(videos.id, link.videoId))
      .get();
    return video?.name ?? null;
  }
  if (link.folderId) {
    const folder = db
      .select({ name: folders.name })
      .from(folders)
      .where(eq(folders.id, link.folderId))
      .get();
    return folder?.name ?? null;
  }
  return null;
}

export type LinkRow = ShareLink & {
  /** Nom du projet ou de la vidéo visée, `null` si elle a été supprimée. */
  target: string | null;
  kind: "folder" | "video";
  /** Nombre de personnes entrées par ce lien. */
  visitors: number;
};

export function listShareLinks(): LinkRow[] {
  const rows = db.select().from(shareLinks).orderBy(asc(shareLinks.createdAt)).all();
  if (rows.length === 0) return [];

  const counts = new Map<string, number>();
  for (const row of db
    .select({ invitedVia: users.invitedVia })
    .from(users)
    .all()) {
    if (!row.invitedVia) continue;
    counts.set(row.invitedVia, (counts.get(row.invitedVia) ?? 0) + 1);
  }

  return rows.map((link) => ({
    ...link,
    kind: link.videoId ? ("video" as const) : ("folder" as const),
    target: describeLink(link),
    visitors: counts.get(link.id) ?? 0,
  }));
}

/**
 * Supprimer le lien le révoque.
 *
 * Les comptes nés du lien **restent**, et leurs notes avec : effacer la
 * review d'un client parce qu'on ferme un lien serait une perte de travail,
 * pas une mesure de sécurité. On retire leurs droits et on coupe leurs
 * sessions, ils ne voient plus rien, mais ce qu'ils ont écrit demeure.
 */
export function deleteShareLink(linkId: string) {
  return db.transaction((tx) => {
    const guests = tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.invitedVia, linkId))
      .all()
      .map((u) => u.id);

    for (const id of guests)
      tx.delete(sessions).where(eq(sessions.userId, id)).run();

    // Tous les droits ouverts par ce lien, à qui que ce soit : un compte né
    // d'un autre lien, ou ouvert à la main, peut être entré par celui-ci.
    // La cascade du DDL le ferait, mais elle dépend du pragma `foreign_keys`.
    tx.delete(folderGrants).where(eq(folderGrants.linkId, linkId)).run();
    tx.delete(videoGrants).where(eq(videoGrants.linkId, linkId)).run();

    tx.delete(shareLinks).where(eq(shareLinks.id, linkId)).run();
    return guests.length;
  });
}

/**
 * Le compte d'un visiteur déjà venu par ce lien, s'il existe.
 *
 * Reconnaître quelqu'un sur son seul prénom serait une usurpation facile
 * ailleurs ; ici ça ne l'est pas : **il faut déjà détenir le lien**, qui
 * donne le même accès de toute façon. Le gain est réel, sans ça, un client
 * dont le cookie a expiré reviendrait sous « Marie (2) » et perdrait le fil
 * de ses propres notes.
 *
 * On reconnaît aussi la forme suffixée : si une autre Marie existait déjà
 * dans l'espace, celle-ci a été enregistrée « Marie (2) » par `uniqueName`,
 * et elle redonne « Marie » en revenant. Chercher le nom exact seulement la
 * faisait renaître en « Marie (3) » à chaque visite.
 */
export function findGuest(linkId: string, name: string) {
  const suffixed = (stored: string) =>
    stored.startsWith(`${name} (`) && /^ \(\d+\)$/.test(stored.slice(name.length));

  return (
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.invitedVia, linkId))
      .orderBy(asc(users.createdAt))
      .all()
      .find((u) => u.name === name || suffixed(u.name)) ?? null
  );
}

/**
 * Nom libre, mais la colonne est unique en base. Plutôt que de refuser
 * « Marie » parce qu'une autre Marie existe ailleurs dans l'espace, on
 * suffixe : deux Marie se distinguent déjà par leur couleur, et on ne va
 * pas demander à un client de trouver un pseudonyme pour commenter une
 * vidéo.
 */
export function uniqueName(wanted: string) {
  const taken = (n: string) =>
    db.select({ id: users.id }).from(users).where(eq(users.name, n)).get() !== undefined;

  if (!taken(wanted)) return wanted;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${wanted} (${i})`;
    if (!taken(candidate)) return candidate;
  }
  return `${wanted} (${randomUUID().slice(0, 4)})`;
}

/**
 * Ouvre au compte l'accès que porte le lien, **rattaché à ce lien** : il se
 * referme avec lui. Un droit posé à la main sur la même cible reste tel quel,
 * il est plus fort ; un droit venu d'un autre lien passe à celui-ci, le plus
 * récemment présenté.
 */
export function applyLinkGrant(userId: string, link: ShareLink) {
  const now = Date.now();
  if (link.videoId) {
    db.insert(videoGrants)
      .values({ userId, videoId: link.videoId, linkId: link.id, createdAt: now })
      .onConflictDoUpdate({
        target: [videoGrants.userId, videoGrants.videoId],
        set: { linkId: link.id },
        setWhere: isNotNull(videoGrants.linkId),
      })
      .run();
  } else if (link.folderId) {
    db.insert(folderGrants)
      .values({ userId, folderId: link.folderId, linkId: link.id, createdAt: now })
      .onConflictDoUpdate({
        target: [folderGrants.userId, folderGrants.folderId],
        set: { linkId: link.id },
        setWhere: isNotNull(folderGrants.linkId),
      })
      .run();
  }
}

/** La cible existe-t-elle ? Vérifié avant de créer un lien vers elle. */
export function targetExists(target: ShareTarget) {
  const table = target.kind === "video" ? videos : folders;
  return (
    db.select({ id: table.id }).from(table).where(eq(table.id, target.id)).get() !==
    undefined
  );
}

/** Où atterrit le client une fois entré. */
export function linkDestination(link: ShareLink) {
  if (link.videoId) return `/v/${link.videoId}`;
  if (link.folderId) return `/f/${link.folderId}`;
  return "/";
}
