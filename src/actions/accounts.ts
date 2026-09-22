"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, users, USER_ROLES, type UserRole } from "@/db/schema";
import {
  countAdmins,
  requireAdmin,
  setGrants,
  setRole,
  type Viewer,
} from "@/lib/access";
import {
  createUser,
  deleteUser,
  findUserByName,
  generatePassword,
  setUserPassword,
} from "@/lib/auth";
import type { ActionResult } from "./folders";

const MAX_NAME = 40;

function refresh() {
  revalidatePath("/", "layout");
}

/**
 * Le mot de passe n'est rendu **qu'une fois**, au moment de la création ou
 * d'une réinitialisation. Il n'est stocké nulle part en clair : si
 * l'administrateur ferme la page sans l'avoir transmis, il en régénère un.
 * C'est volontairement plus rude qu'un rappel — un mot de passe qu'on peut
 * relire plus tard est un mot de passe qui traîne.
 */
export type PasswordResult =
  | { ok: true; name: string; password: string }
  | { ok: false; error: string };

function checkName(raw: string): { name: string } | { error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { error: "Le nom ne peut pas être vide." };
  if (name.length > MAX_NAME) return { error: `${MAX_NAME} caractères maximum.` };
  if (findUserByName(name)) return { error: `« ${name} » existe déjà.` };
  return { name };
}

function checkRole(raw: string): UserRole | null {
  return (USER_ROLES as readonly string[]).includes(raw) ? (raw as UserRole) : null;
}

/**
 * Crée un compte et rend son mot de passe initial.
 *
 * L'administrateur ne choisit pas le mot de passe : il transmet celui que
 * l'app a tiré. Ça lui évite d'en inventer un faible, et surtout ça évite
 * qu'il connaisse par construction celui d'un client.
 */
export async function createAccountAction(input: {
  name: string;
  role: string;
  folderIds: string[];
}): Promise<PasswordResult> {
  await requireAdmin();

  const checked = checkName(input.name);
  if ("error" in checked) return { ok: false, error: checked.error };

  const role = checkRole(input.role);
  if (!role) return { ok: false, error: "Rôle inconnu." };

  const password = generatePassword();
  const user = await createUser(checked.name, password, role);

  // Les projets ne concernent qu'un invité : `setRole` les efface pour les
  // autres, on ne les pose donc que là où ils ont un sens.
  if (role === "invite") setGrants(user.id, input.folderIds);

  refresh();
  return { ok: true, name: checked.name, password };
}

export async function setAccountRoleAction(
  userId: string,
  rawRole: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const role = checkRole(rawRole);
  if (!role) return { ok: false, error: "Rôle inconnu." };

  const guard = await protectLastAdmin(admin, userId, role);
  if (guard) return guard;

  setRole(userId, role);
  refresh();
  return { ok: true };
}

export async function setAccountGrantsAction(
  userId: string,
  folderIds: string[],
): Promise<ActionResult> {
  await requireAdmin();

  const target = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!target) return { ok: false, error: "Ce compte n'existe plus." };
  if (target.role !== "invite")
    return { ok: false, error: "Ce compte voit déjà tout l'espace." };

  setGrants(userId, folderIds);
  refresh();
  return { ok: true };
}

export async function resetAccountPasswordAction(
  userId: string,
): Promise<PasswordResult> {
  await requireAdmin();

  const target = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!target) return { ok: false, error: "Ce compte n'existe plus." };

  const password = generatePassword();
  await setUserPassword(userId, password);
  refresh();
  return { ok: true, name: target.name, password };
}

/**
 * Nombre de notes qui partiraient avec le compte. Les commentaires sont liés
 * à leur auteur par une cascade : supprimer quelqu'un efface sa review. On
 * l'annonce avant de demander confirmation plutôt que de le découvrir après.
 */
export async function countAccountNotesAction(userId: string): Promise<number> {
  await requireAdmin();
  return db.select({ id: comments.id }).from(comments).where(eq(comments.userId, userId)).all()
    .length;
}

export async function deleteAccountAction(userId: string): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (userId === admin.id)
    return { ok: false, error: "On ne supprime pas son propre compte." };

  const target = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!target) return { ok: false, error: "Ce compte n'existe plus." };

  const guard = await protectLastAdmin(admin, userId, "invite");
  if (guard) return guard;

  deleteUser(userId);
  refresh();
  return { ok: true };
}

/**
 * Empêche l'espace de se retrouver sans administrateur — par rétrogradation
 * comme par suppression. Sans ce garde-fou, plus personne ne pourrait créer
 * ni rétablir un compte, et il faudrait rouvrir la base à la main.
 */
async function protectLastAdmin(
  admin: Viewer,
  userId: string,
  nextRole: UserRole,
): Promise<ActionResult | null> {
  if (nextRole === "admin") return null;

  const target = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!target || target.role !== "admin") return null;

  if (countAdmins() <= 1)
    return {
      ok: false,
      error: "C'est le dernier administrateur : nomme-en un autre d'abord.",
    };
  return null;
}
