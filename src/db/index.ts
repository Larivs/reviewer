import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DDL } from "./ddl";
import * as schema from "./schema";

export const DATA_DIR = path.join(process.cwd(), "data");
export const VIDEO_DIR = path.join(DATA_DIR, "videos");
export const THUMB_DIR = path.join(DATA_DIR, "thumbs");
export const SPRITE_DIR = path.join(DATA_DIR, "sprites");

function ensureColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === column))
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function connect() {
  mkdirSync(VIDEO_DIR, { recursive: true });
  mkdirSync(THUMB_DIR, { recursive: true });
  mkdirSync(SPRITE_DIR, { recursive: true });

  const sqlite = new Database(path.join(DATA_DIR, "reviewer.db"));
  // WAL : lectures concurrentes pendant une écriture. Indispensable dès
  // qu'on est plusieurs à consulter en même temps.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(DDL);

  // `CREATE TABLE IF NOT EXISTS` ne touche pas une table existante : les
  // colonnes ajoutées après coup doivent passer par un ALTER explicite.
  // Idempotent, et bien plus léger qu'un dossier de migrations pour une
  // app locale.
  ensureColumn(sqlite, "comments", "timecode_end", "REAL");
  ensureColumn(sqlite, "comments", "annotation", "TEXT");
  // Défaut volontairement à 'admin' et non 'membre' : cette colonne arrive
  // sur une base où les comptes existants voyaient et faisaient déjà tout.
  // Les rétrograder en silence leur retirerait des droits sans que personne
  // ne l'ait demandé, on préfère qu'ils gardent les leurs et que le premier
  // admin en redescende qui il veut depuis la page des comptes.
  ensureColumn(sqlite, "users", "role", "TEXT NOT NULL DEFAULT 'admin'");
  ensureColumn(sqlite, "users", "invited_via", "TEXT");

  return drizzle(sqlite, { schema });
}

// Next recharge les modules à chaque édition en dev : sans ce cache global
// on ouvrirait une nouvelle connexion SQLite à chaque sauvegarde.
const globalForDb = globalThis as unknown as {
  __reviewerDb?: ReturnType<typeof connect>;
};

export const db = globalForDb.__reviewerDb ?? connect();
if (process.env.NODE_ENV !== "production") globalForDb.__reviewerDb = db;
