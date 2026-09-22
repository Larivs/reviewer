/**
 * Création / réinitialisation des comptes.
 *   npm run seed
 * Les mots de passe sont saisis à la main et masqués : ils ne transitent
 * ni par un fichier, ni par l'historique du shell.
 */
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { DDL } from "../src/db/ddl.ts";

const DEFAULT_NAMES = ["Toma", "Hugo", "Jérôme"];
const MIN_LENGTH = 8;

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

function askHidden(question) {
  process.stdout.write(question);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  // On coupe l'écho pour que la frappe n'apparaisse pas à l'écran.
  rl._writeToOutput = () => {};
  return new Promise((resolve) =>
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

async function askNewPassword(name) {
  for (;;) {
    const first = await askHidden(`  Mot de passe pour ${name} : `);
    if (first.length < MIN_LENGTH) {
      console.log(`  ⚠ ${MIN_LENGTH} caractères minimum.`);
      continue;
    }
    const second = await askHidden("  Confirmation : ");
    if (first !== second) {
      console.log("  ⚠ Les deux saisies diffèrent.");
      continue;
    }
    return first;
  }
}

const dataDir = path.join(process.cwd(), "data");
mkdirSync(path.join(dataDir, "videos"), { recursive: true });

const db = new Database(path.join(dataDir, "reviewer.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
// Le serveur tient peut-être la base au moment où on crée les comptes — c'est
// même le cas courant, on ne l'arrête pas pour ajouter un utilisateur. Sans
// ce délai d'attente, SQLite abandonne aussitôt sur un verrou d'écriture et le
// script échoue en pleine saisie de mot de passe.
db.pragma("busy_timeout = 5000");
db.exec(DDL);

const findUser = db.prepare("SELECT id, name FROM users WHERE name = ?");
const listUsers = db.prepare(`
  SELECT id, name, password_hash, role,
         (SELECT count(*) FROM comments c WHERE c.user_id = users.id) AS notes
  FROM users ORDER BY created_at
`);
const deleteUser = db.prepare("DELETE FROM users WHERE id = ?");
const insertUser = db.prepare(
  "INSERT INTO users (id, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
);
const countUsers = db.prepare("SELECT count(*) AS n FROM users");
const updatePassword = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");

console.log("\n── Comptes Reviewer ──\n");

const extra = await ask(
  `Comptes par défaut : ${DEFAULT_NAMES.join(", ")}.\nAutres noms à ajouter (séparés par une virgule, vide pour aucun) : `,
);
const names = [
  ...DEFAULT_NAMES,
  ...extra.split(",").map((n) => n.trim()).filter(Boolean),
];

console.log("");

for (const name of names) {
  const existing = findUser.get(name);

  if (existing) {
    const answer = await ask(`${name} existe déjà. Réinitialiser son mot de passe ? (o/N) `);
    if (answer.toLowerCase() !== "o") {
      console.log("  → inchangé\n");
      continue;
    }
    updatePassword.run(await hash(await askNewPassword(name)), existing.id);
    console.log("  ✓ mot de passe mis à jour\n");
  } else {
    console.log(`${name} — nouveau compte`);
    // Le tout premier compte de l'instance en est l'administrateur : c'est
    // lui qui creera les suivants depuis l'app. Sans cette regle, une base
    // neuve naitrait sans personne pour ouvrir un compte a qui que ce soit.
    const role = countUsers.get().n === 0 ? "admin" : "membre";
    insertUser.run(
      randomUUID(),
      name,
      await hash(await askNewPassword(name)),
      role,
      Date.now(),
    );
    console.log(`  role : ${role}`);
    console.log("  ✓ compte créé\n");
  }
}

// ── Ménage ────────────────────────────────────────────────────────────
// Un compte sans mot de passe utilisable — celui créé automatiquement quand
// l'authentification était débrayée — encombrerait la liste de connexion
// sans jamais pouvoir servir.

const inutilisables = listUsers.all().filter((u) => u.password_hash === "!");

if (inutilisables.length > 0) {
  console.log("── Comptes sans mot de passe utilisable ──");
  console.log("");
  for (const compte of inutilisables) {
    const avecNotes =
      compte.notes > 0
        ? ` — ATTENTION : ses ${compte.notes} commentaire(s) partiront avec`
        : " — aucun commentaire";
    const reponse = await ask(`Supprimer « ${compte.name} » ?${avecNotes} (o/N) `);
    if (reponse.toLowerCase() === "o") {
      deleteUser.run(compte.id);
      console.log("  ✓ supprimé");
    } else {
      console.log("  → conservé (il restera listé sans pouvoir se connecter)");
    }
    console.log("");
  }
}

console.log("Comptes finaux :");
for (const u of listUsers.all())
  console.log(
    `  ${u.name} [${u.role}]${u.password_hash === "!" ? "  (sans mot de passe)" : ""}`,
  );
console.log("");

db.close();
console.log("Terminé. Lance `npm run dev` puis connecte-toi.\n");
