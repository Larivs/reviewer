/**
 * Sauvegarde de `data/`, faite correctement.
 *
 * Le README affirmait « la sauvegarde, c'est la copie de data/ ». C'est faux
 * tant que le serveur tourne, et la démonstration est facile à faire :
 *
 *     data/reviewer.db        60 Ko
 *     data/reviewer.db-wal   896 Ko
 *
 * La base est en mode WAL. Des transactions validées vivent dans le fichier
 * `-wal` et ne sont recopiées dans le `.db` qu'au prochain point de contrôle.
 * Copier `reviewer.db` seul perd donc les notes les plus récentes -
 * silencieusement, ce qui est le pire cas : on croit avoir une sauvegarde. Et
 * copier les trois fichiers en pleine écriture peut donner un instantané
 * déchiré, incohérent au rechargement.
 *
 * D'où l'API `backup()` de SQLite, qui prend un instantané cohérent d'une
 * base vivante sans l'arrêter, puis un `integrity_check` sur la copie : une
 * sauvegarde qu'on n'a jamais vérifiée n'est pas une sauvegarde.
 *
 * DISPOSITION. Un premier jet créait un dossier horodaté complet à chaque
 * exécution, ce qui rendait la copie incrémentale inutile, la destination
 * étant toujours vide. Avec une bibliothèque de plusieurs dizaines de
 * gigaoctets, chaque sauvegarde aurait tout dupliqué, et on aurait cessé de
 * la lancer. La disposition suit donc la nature des données : les média
 * s'accumulent sans jamais changer, ils sont nommés d'après un uuid et ne
 * sont jamais réécrits, tandis que la base change sans arrêt mais tient
 * dans quelques mégaoctets.
 *
 *     reviewer-backups/
 *       videos/ thumbs/ sprites/          un miroir, jamais recopié deux fois
 *       db/reviewer_2026-09-09_2232.db    un instantané daté par exécution
 *
 *     npm run backup                      -> vers ../reviewer-backups
 *     npm run backup -- D:/sauvegardes    -> vers D:/sauvegardes
 */
import Database from "better-sqlite3";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const DATA = path.join(process.cwd(), "data");
const DB = path.join(DATA, "reviewer.db");
/** Les trois dossiers de média, dans l'ordre où on les recopie. */
const MEDIA = ["videos", "thumbs", "sprites"];

const NL = "\n";

/** `2026-09-09_2232`, triable, lisible, et valide comme nom de fichier. */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

async function exists(file) {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}

/**
 * Instantané cohérent de la base, WAL compris, sans arrêter le serveur.
 *
 * Écrit d'abord sous un nom temporaire puis renomme : une interruption en
 * cours de route laisse un `.partiel` visible au lieu d'un fichier qui a
 * l'air d'être une sauvegarde valide.
 */
async function backupDatabase(destination) {
  const source = new Database(DB, { readonly: true });
  const temporary = `${destination}.partiel`;
  try {
    await source.backup(temporary);
  } finally {
    source.close();
  }

  // Vérification sur la COPIE, pas sur l'original : c'est la copie dont on
  // aura besoin le jour où ça tourne mal.
  //
  // Ouverte en écriture pour une raison : `backup()` conserve le mode WAL de
  // la source, donc la copie s'accompagne aussitôt d'un `-wal` et d'un
  // `-shm`. On la repasse en journal `delete`, ce qui fait de l'instantané un
  // **fichier unique et autonome**, la restauration devient un simple
  // renommage, et un dossier de sauvegardes qui laisse traîner des annexes
  // « .partiel-wal » donne l'impression que quelque chose a échoué.
  const copy = new Database(temporary);
  let verdict;
  let counts;
  try {
    copy.pragma("journal_mode = delete");
    verdict = copy.pragma("integrity_check", { simple: true });
    counts = {
      comptes: copy.prepare("SELECT count(*) n FROM users").get().n,
      dossiers: copy.prepare("SELECT count(*) n FROM folders").get().n,
      videos: copy.prepare("SELECT count(*) n FROM videos").get().n,
      notes: copy.prepare("SELECT count(*) n FROM comments").get().n,
    };
  } finally {
    copy.close();
  }

  // Filet : si SQLite a tout de même laissé une annexe, elle ne survit pas.
  await Promise.all(
    ["-wal", "-shm"].map((suffix) => unlink(temporary + suffix).catch(() => {})),
  );

  if (verdict !== "ok") {
    await unlink(temporary).catch(() => {});
    throw new Error(`la copie de la base est corrompue : ${verdict}`);
  }

  await rename(temporary, destination);
  return counts;
}

/**
 * Ce que le miroir a rencontré sur le disque, par dossier. Sert au contrôle
 * de cohérence base/disque de la fin, c'est le seul endroit du projet où on
 * regarde les deux ensemble.
 */
const seen = {};

/** Ne recopie que ce qui manque : un fichier média ne change jamais. */
async function mirror(from, to) {
  const entries = await readdir(from).catch(() => []);
  seen[path.basename(from)] = new Set(entries);
  await mkdir(to, { recursive: true });

  let copied = 0;
  let copiedBytes = 0;
  let skipped = 0;

  for (const name of entries) {
    const source = path.join(from, name);
    const info = await stat(source);
    if (!info.isFile()) continue;

    const target = path.join(to, name);
    const already = await exists(target);
    // La taille suffit comme témoin : le nom est un uuid, il n'est jamais
    // réutilisé pour un contenu différent.
    if (already && already.size === info.size) {
      skipped += 1;
      continue;
    }

    // En flux, pas en mémoire : un rush peut peser plusieurs gigaoctets.
    await pipeline(createReadStream(source), createWriteStream(target));
    copied += 1;
    copiedBytes += info.size;
  }

  return { copied, copiedBytes, skipped };
}

/** Vidéos référencées en base dont le fichier a disparu du disque. */
function orphans() {
  const db = new Database(DB, { readonly: true });
  try {
    return db
      .prepare("SELECT name, filename FROM videos")
      .all()
      .filter((row) => !seen.videos?.has(row.filename));
  } finally {
    db.close();
  }
}

async function main() {
  if (!(await exists(DB))) {
    console.error(`Aucune base à ${DB}. Rien à sauvegarder.`);
    process.exit(1);
  }

  const root = path.resolve(
    process.argv[2] ?? path.join(process.cwd(), "..", "reviewer-backups"),
  );
  const snapshots = path.join(root, "db");
  await mkdir(snapshots, { recursive: true });

  console.log(`${NL}  Sauvegarde vers ${root}${NL}`);

  const counts = await backupDatabase(
    path.join(snapshots, `reviewer_${stamp()}.db`),
  );
  console.log(
    `  base       ✓ vérifiée, ${counts.comptes} comptes, ${counts.dossiers} dossiers, ` +
      `${counts.videos} vidéos, ${counts.notes} notes`,
  );

  let copiedTotal = 0;
  let keptTotal = 0;
  for (const folder of MEDIA) {
    const result = await mirror(path.join(DATA, folder), path.join(root, folder));
    copiedTotal += result.copiedBytes;
    keptTotal += result.skipped;
    const deja = result.skipped > 0 ? `, ${result.skipped} déjà là` : "";
    console.log(
      `  ${folder.padEnd(10)} ✓ ${result.copied} copiés (${human(result.copiedBytes)})${deja}`,
    );
  }

  const kept = (await readdir(snapshots)).filter((f) => f.endsWith(".db"));
  const s = kept.length > 1 ? "s" : "";
  console.log(
    `${NL}  ${human(copiedTotal)} de média copiés` +
      (keptTotal > 0 ? `, ${keptTotal} fichiers déjà présents laissés en place` : "") +
      `.${NL}  ${kept.length} instantané${s} de base conservé${s}.`,
  );

  // Volontairement aucune purge automatique : effacer des sauvegardes de sa
  // propre initiative est le genre de zèle qui se paie très cher un jour.
  if (kept.length > 30)
    console.log(`  (tu peux effacer les plus anciens à la main dans ${snapshots})`);

  const perdus = orphans();
  if (perdus.length > 0) {
    console.log(
      `${NL}  ⚠ ${perdus.length} vidéo(s) référencée(s) en base sans fichier sur le disque :`,
    );
    for (const v of perdus) console.log(`      ${v.name} (${v.filename})`);
  }

  console.log(
    `${NL}  RESTAURATION : arrêter le serveur, puis remplacer data/reviewer.db par` +
      `${NL}  l'instantané voulu, **renommé** reviewer.db. Supprimer aussi les fichiers` +
      `${NL}  data/reviewer.db-wal et data/reviewer.db-shm s'ils existent : l'instantané` +
      `${NL}  est complet, un journal d'une autre époque le corromprait. Les média se` +
      `${NL}  recopient depuis les dossiers du miroir.${NL}`,
  );
}

main().catch((error) => {
  console.error(`${NL}  Échec de la sauvegarde : ${error.message}${NL}`);
  process.exit(1);
});
