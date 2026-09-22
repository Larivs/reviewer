"use server";

import { revalidatePath } from "next/cache";
import { FORBIDDEN, requireStaff } from "@/lib/access";
import {
  countDescendants,
  createFolder,
  deleteFolderRecursive,
  getFolder,
  MAX_NAME_LENGTH,
  nameTaken,
  normalizeName,
  renameFolder,
} from "@/lib/folders";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Une seule invalidation large : l'arbre est partout dans l'interface. */
function refresh() {
  revalidatePath("/", "layout");
}

function validateName(raw: string): { name: string } | { error: string } {
  const name = normalizeName(raw);
  if (!name) return { error: "Le nom ne peut pas être vide." };
  if (raw.trim().length > MAX_NAME_LENGTH)
    return { error: `${MAX_NAME_LENGTH} caractères maximum.` };
  return { name };
}

export async function createFolderAction(
  parentId: string | null,
  rawName: string,
): Promise<ActionResult> {
  if (!(await requireStaff())) return FORBIDDEN;

  const checked = validateName(rawName);
  if ("error" in checked) return { ok: false, error: checked.error };

  if (parentId && !getFolder(parentId))
    return { ok: false, error: "Ce dossier n'existe plus." };

  if (nameTaken(parentId, checked.name))
    return { ok: false, error: "Un dossier porte déjà ce nom ici." };

  createFolder(parentId, checked.name);
  refresh();
  return { ok: true };
}

export async function renameFolderAction(
  id: string,
  rawName: string,
): Promise<ActionResult> {
  if (!(await requireStaff())) return FORBIDDEN;

  const folder = getFolder(id);
  if (!folder) return { ok: false, error: "Ce dossier n'existe plus." };

  const checked = validateName(rawName);
  if ("error" in checked) return { ok: false, error: checked.error };
  if (checked.name === folder.name) return { ok: true };

  if (nameTaken(folder.parentId, checked.name, id))
    return { ok: false, error: "Un dossier porte déjà ce nom ici." };

  renameFolder(id, checked.name);
  refresh();
  return { ok: true };
}

/**
 * Contenu réel de tout le sous-arbre, appelé avant de confirmer une
 * suppression : les enfants directs sous-estiment ce qui va disparaître.
 */
export async function countFolderContentsAction(id: string) {
  // Renvoie un décompte, pas un `ActionResult` : sans droits on rend un
  // décompte nul plutôt qu'une erreur d'une autre forme, que l'appelant ne
  // saurait pas lire. De toute façon la suppression, elle, refusera.
  if (!(await requireStaff())) return { folders: 0, videos: 0 };
  return countDescendants(id);
}

export async function deleteFolderAction(id: string): Promise<ActionResult> {
  if (!(await requireStaff())) return FORBIDDEN;

  if (!getFolder(id)) return { ok: false, error: "Ce dossier n'existe plus." };

  await deleteFolderRecursive(id);
  refresh();
  return { ok: true };
}
