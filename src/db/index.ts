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
  if (columns.some((c) => c.name === column)) return false;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
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

  ensureColumn(sqlite, "videos", "state", "TEXT NOT NULL DEFAULT 'ready'");
  ensureColumn(sqlite, "videos", "stack_id", "TEXT");
  ensureColumn(sqlite, "videos", "version", "INTEGER NOT NULL DEFAULT 1");
  // Après les colonnes : sur une base antérieure, l'index ne peut pas être
  // créé par le DDL, la colonne n'existe pas encore à ce moment-là.
  sqlite.exec("CREATE INDEX IF NOT EXISTS videos_stack_idx ON videos(stack_id)");
  // Une conversion ne survit pas à un arrêt du serveur : ce qui était en
  // cours ne finira jamais, autant le dire que laisser tourner un sablier.
  sqlite.exec("UPDATE videos SET state = 'failed' WHERE state = 'processing'");

  // Un droit ouvert par un lien porte désormais ce lien. Sur une base
  // antérieure, on rattache les droits existants au lien qui a fait naître le
  // compte, quand la cible correspond : ce sont exactement ceux que la
  // révocation retirait déjà. Les autres restent des droits posés à la main.
  const linkRef = "TEXT REFERENCES share_links(id) ON DELETE CASCADE";
  if (ensureColumn(sqlite, "folder_grants", "link_id", linkRef))
    sqlite.exec(`
      UPDATE folder_grants SET link_id = (
        SELECT l.id FROM users u JOIN share_links l ON l.id = u.invited_via
        WHERE u.id = folder_grants.user_id AND l.folder_id = folder_grants.folder_id
      )`);
  if (ensureColumn(sqlite, "video_grants", "link_id", linkRef))
    sqlite.exec(`
      UPDATE video_grants SET link_id = (
        SELECT l.id FROM users u JOIN share_links l ON l.id = u.invited_via
        WHERE u.id = video_grants.user_id AND l.video_id = video_grants.video_id
      )`);

  return drizzle(sqlite, { schema });
}

// Next recharge les modules à chaque édition en dev : sans ce cache global
// on ouvrirait une nouvelle connexion SQLite à chaque sauvegarde.
const globalForDb = globalThis as unknown as {
  __reviewerDb?: ReturnType<typeof connect>;
};

// Gardé aussi en production : une seule connexion par processus, quel que
// soit le nombre de paquets serveur qui importent ce module.
export const db = (globalForDb.__reviewerDb ??= connect());
