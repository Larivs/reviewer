/**
 * Génère les planches d'aperçu manquantes.
 *   npm run sprites
 * Utile une seule fois, pour les vidéos envoyées avant l'arrivée de
 * l'aperçu au survol. Les nouvelles en reçoivent une à l'upload.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import { makeSprite } from "../src/lib/media.ts";

const dataDir = path.join(process.cwd(), "data");
const db = new Database(path.join(dataDir, "reviewer.db"));

const videos = db.prepare("SELECT id, name, filename, duration FROM videos").all();
let faites = 0;
let ignorees = 0;

for (const video of videos) {
  const sortie = path.join(dataDir, "sprites", `${video.id}.jpg`);
  if (existsSync(sortie)) {
    ignorees += 1;
    continue;
  }
  const source = path.join(dataDir, "videos", video.filename);
  if (!existsSync(source) || !video.duration) {
    console.log(`  ⚠ ${video.name}, fichier ou durée manquants`);
    continue;
  }

  process.stdout.write(`  ${video.name}… `);
  try {
    await makeSprite(source, sortie, video.duration);
    console.log("ok");
    faites += 1;
  } catch (error) {
    console.log("échec :", error instanceof Error ? error.message : error);
  }
}

db.close();
console.log(`\n${faites} planche(s) générée(s), ${ignorees} déjà présente(s).`);
