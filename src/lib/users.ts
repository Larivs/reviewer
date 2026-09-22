import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * Rang d'ancienneté de chaque compte, qui sert d'index de couleur.
 *
 * Pas de colonne en base, et surtout pas d'empreinte du `user_id` : un hachage
 * donne des collisions dès le troisième compte, et voir deux personnes de la
 * même couleur est pire que pas de couleur du tout. Le rang, lui, ne bouge
 * plus une fois le compte créé — la couleur de Jérôme reste celle de Jérôme.
 *
 * La table fait trois lignes : on la relit à chaque rendu plutôt que
 * d'entretenir un cache qui se périmerait au prochain compte créé.
 */
export function userColorIndexes(): Map<string, number> {
  const rows = db
    .select({ id: users.id })
    .from(users)
    // `id` en second critère : deux comptes créés dans la même milliseconde
    // garderaient sinon un ordre arbitraire, donc des couleurs qui sautent.
    .orderBy(asc(users.createdAt), asc(users.id))
    .all();

  return new Map(rows.map((row, i) => [row.id, i]));
}

export function userColorIndex(userId: string): number {
  return userColorIndexes().get(userId) ?? 0;
}
