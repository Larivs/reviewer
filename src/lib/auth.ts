import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type UserRole } from "@/db/schema";
import { AUTH_DISABLED } from "./config";

const COOKIE = "reviewer_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

export type CurrentUser = { id: string; name: string };

export function hashPassword(password: string) {
  return argonHash(password);
}

/**
 * Une empreinte illisible n'est pas une panne, c'est un refus : les comptes
 * nés d'un lien portent `"!"` exprès, et tenter de s'y connecter par le
 * formulaire doit échouer comme un mauvais mot de passe, pas en erreur 500
 * qui dirait au passage que ce nom existe.
 */
export function verifyPassword(storedHash: string, password: string) {
  return argonVerify(storedHash, password).catch(() => false);
}

/** Le cookie porte le token en clair ; la base n'en garde que l'empreinte. */
function fingerprint(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * La requête arrive-t-elle en HTTPS ?
 *
 * Le cookie était posé avec `secure: false` en dur, au motif que l'app
 * tournait en HTTP sur un réseau local ou via Tailscale. C'était vrai tant
 * que personne ne l'hébergeait ailleurs. Dès qu'une instance est publiée
 * derrière un nom de domaine, ce que fait quiconque envoie des liens de
 * review à ses clients, le jeton de session repartirait en clair.
 *
 * On détecte plutôt que de demander un réglage : `x-forwarded-proto` est ce
 * que pose tout proxy sérieux, et il peut en contenir plusieurs séparés par
 * des virgules, d'où le premier segment seulement. En HTTP local, rien ne
 * change, un cookie `secure` y serait tout simplement ignoré, et plus
 * personne ne pourrait se connecter.
 */
async function requestIsSecure() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "";
  return proto.split(",")[0].trim().toLowerCase() === "https";
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;

  db.insert(sessions)
    .values({ id: fingerprint(token), userId, expiresAt })
    .run();
  db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
    secure: await requestIsSecure(),
  });
}

/**
 * Ferme la session en base **sans toucher au cookie**, pour un rendu de
 * page : Next interdit d'y modifier les cookies, et l'appel levait une
 * erreur. Le cookie restant ne désigne plus aucune session, il ne vaut rien.
 */
export async function revokeSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) db.delete(sessions).where(eq(sessions.id, fingerprint(token))).run();
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.delete(sessions).where(eq(sessions.id, fingerprint(token))).run();
  jar.delete(COOKIE);
}

/**
 * Compte utilisé quand l'authentification est désactivée : le premier créé,
 * sinon un compte « Dev » de secours. Les commentaires ont besoin d'un
 * user_id réel, on ne peut pas se contenter d'un utilisateur fictif.
 */
function devUser(): CurrentUser {
  const first = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .orderBy(asc(users.createdAt))
    .get();
  if (first) return first;

  const fallback = { id: randomUUID(), name: "Dev" };
  db.insert(users)
    .values({
      ...fallback,
      // Le compte de secours doit pouvoir tout faire : il sert justement à
      // inspecter l'app quand l'authentification est débrayée.
      role: "admin" as const,
      // Hash volontairement invalide : ce compte ne peut pas servir à se
      // connecter une fois l'authentification réactivée.
      passwordHash: "!",
      createdAt: Date.now(),
    })
    .run();
  return fallback;
}

/** `cache` évite de refaire la requête à chaque composant d'un même rendu. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (AUTH_DISABLED) return devUser();

  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const row = db
    .select({ id: users.id, name: users.name, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, fingerprint(token)))
    .get();

  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, fingerprint(token))).run();
    return null;
  }
  return { id: row.id, name: row.name };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function findUserByName(name: string) {
  return db.select().from(users).where(eq(users.name, name)).get() ?? null;
}

export async function createUser(
  name: string,
  password: string,
  role: UserRole = "membre",
) {
  const user = {
    id: randomUUID(),
    name,
    passwordHash: await hashPassword(password),
    role,
    createdAt: Date.now(),
  };
  db.insert(users).values(user).run();
  return user;
}

export async function setUserPassword(userId: string, password: string) {
  db.update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, userId))
    .run();
}

/**
 * Supprime le compte. Ses notes partent avec, par cascade, c'est pour ça
 * que l'interface annonce leur nombre avant de demander confirmation. Les
 * sessions ouvertes tombent aussi, donc la personne est déconnectée sur le
 * champ plutôt qu'à l'expiration de son cookie.
 */
export function deleteUser(userId: string) {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
  db.delete(users).where(eq(users.id, userId)).run();
}

/**
 * Mot de passe initial, à transmettre de vive voix ou par message. C'est le
 * remplaçant de l'e-mail d'invitation : il n'y a pas de serveur de courrier
 * sur un réseau local, et l'administrateur ne doit pas inventer lui-même le
 * mot de passe de quelqu'un d'autre.
 *
 * L'alphabet écarte ce qui se lit mal quand on dicte ou qu'on recopie :
 * 0/O, 1/l/I, 5/S, 8/B. Cinq groupes de quatre plutôt qu'une chaîne
 * continue, un mot de passe qu'on doit lire à voix haute se découpe.
 *
 * Vingt caractères sur 27 : 95 bits. `randomInt` tire sans biais, là où un
 * octet modulo 27 favorisait les treize premières lettres.
 */
export function generatePassword() {
  const alphabet = "ACDEFGHJKMNPQRTUVWXYZ234679";
  const chars = Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]);
  return [0, 4, 8, 12, 16].map((i) => chars.slice(i, i + 4).join("")).join("-");
}
