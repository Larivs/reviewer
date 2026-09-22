"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin, requireStaff, getViewer } from "@/lib/access";
import { createSession, hashPassword } from "@/lib/auth";
import {
  applyLinkGrant,
  createShareLink,
  deleteShareLink,
  findGuest,
  getLinkByToken,
  linkDestination,
  linkIsExpired,
  uniqueName,
} from "@/lib/share";
import type { LinkDuration, ShareTarget } from "@/lib/share-types";
import { randomUUID } from "node:crypto";
import type { ActionResult } from "./folders";

const MAX_GUEST_NAME = 40;

function refresh() {
  revalidatePath("/", "layout");
}

export type ShareResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * Créer un lien est un geste de rangement : il appartient au studio, pas à
 * un invité, qui pourrait sinon rouvrir à d'autres ce qu'on lui a ouvert.
 */
export async function createShareLinkAction(
  target: ShareTarget,
  duration: LinkDuration,
): Promise<ShareResult> {
  const staff = await requireStaff();
  if (!staff) return { ok: false, error: "Ton compte n'a pas les droits pour ça." };

  const link = createShareLink(target, duration, staff.id);
  refresh();
  return { ok: true, token: link.token };
}

export async function deleteShareLinkAction(linkId: string): Promise<ActionResult> {
  await requireAdmin();
  deleteShareLink(linkId);
  refresh();
  return { ok: true };
}

/**
 * Le client entre.
 *
 * Son compte est un invité sans mot de passe utilisable : `"!"` comme
 * empreinte, la même convention que le compte de secours. Il ne pourra donc
 * jamais passer par l'écran de connexion, le lien est sa seule porte, et
 * elle se referme avec lui.
 */
export async function joinWithLinkAction(
  token: string,
  rawName: string,
): Promise<ActionResult> {
  const link = getLinkByToken(token);
  if (!link || linkIsExpired(link))
    return { ok: false, error: "Ce lien n'est plus valide." };

  const name = rawName.trim().replace(/\s+/g, " ").slice(0, MAX_GUEST_NAME);
  if (!name) return { ok: false, error: "Dis-nous comment tu t'appelles." };

  // Déjà connecté : on ajoute l'accès au compte en cours plutôt que d'en
  // créer un second. C'est le cas quand le studio ouvre son propre lien pour
  // vérifier ce que le client verra.
  const current = await getViewer();
  if (current) {
    applyLinkGrant(current.id, link);
    refresh();
    redirect(linkDestination(link));
  }

  const known = findGuest(link.id, name);
  const userId = known?.id ?? randomUUID();

  if (!known) {
    db.insert(users)
      .values({
        id: userId,
        name: uniqueName(name),
        // Empreinte volontairement invalide : ce compte ne peut pas servir
        // à se connecter par le formulaire, seulement par le lien.
        passwordHash: "!",
        role: "invite",
        invitedVia: link.id,
        createdAt: Date.now(),
      })
      .run();
  }

  applyLinkGrant(userId, link);
  await createSession(userId);
  refresh();
  redirect(linkDestination(link));
}

/**
 * Première installation : tant qu'aucun compte n'existe, n'importe qui peut
 * créer l'administrateur. La fenêtre se referme d'elle-même dès qu'il y a
 * un compte, c'est ce qui rend la page sûre sans secret à transmettre.
 */
export async function setupAdminAction(
  name: string,
  password: string,
): Promise<ActionResult> {
  const count = db.select({ id: users.id }).from(users).all().length;
  if (count > 0)
    return { ok: false, error: "Cette instance est déjà installée." };

  const cleaned = name.trim().replace(/\s+/g, " ").slice(0, MAX_GUEST_NAME);
  if (!cleaned) return { ok: false, error: "Le nom ne peut pas être vide." };
  if (password.length < 8)
    return { ok: false, error: "Huit caractères minimum pour le mot de passe." };

  const id = randomUUID();
  db.insert(users)
    .values({
      id,
      name: cleaned,
      passwordHash: await hashPassword(password),
      role: "admin",
      createdAt: Date.now(),
    })
    .run();

  await createSession(id);
  refresh();
  return { ok: true };
}

/** Le compte existe-t-il déjà ? Sert à fermer la page d'installation. */
export async function instanceIsInstalled() {
  return db.select({ id: users.id }).from(users).all().length > 0;
}

/** Nom du compte visé, pour la liste des liens. */
export async function linkAuthorName(userId: string) {
  await requireAdmin();
  return (
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get()?.name ??
    null
  );
}
