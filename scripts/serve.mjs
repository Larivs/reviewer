/**
 * Démarrage en production.
 *
 *     npm run serve
 *
 * `npm start` lance `next start` et rien d'autre. Trois choses manquaient,
 * et ce sont précisément celles qu'on oublie au mauvais moment :
 *
 * 1. GARDE-FOU SUR L'AUTHENTIFICATION. `AUTH_DISABLED=1` ouvre l'app sans
 *    écran de connexion. Sur le poste du développeur c'est commode ; sur un
 *    réseau où deux autres personnes attendent, c'est un partage ouvert -
 *    il suffit de deviner une URL pour lire, écrire, supprimer. Le script
 *    **refuse de démarrer** dans cet état plutôt que d'afficher un
 *    avertissement de plus : on lance ce script en partant chercher un café,
 *    et un avertissement de plus ne serait lu par personne.
 *
 * 2. LE BUILD À JOUR. `next start` sert `.next` sans jamais dire qu'il est
 *    périmé. On modifie le code, on relance, et on ne comprend pas pourquoi
 *    rien ne change. Ici on compare la date du build à celle du fichier
 *    source le plus récent, et on reconstruit si besoin.
 *
 * 3. L'ADRESSE À DONNER AUX AUTRES. `next start -H 0.0.0.0` annonce
 *    « Network: http://0.0.0.0:3000 », qui ne s'ouvre sur aucune machine.
 *    On affiche donc les vraies adresses : l'IP du réseau local, et celle
 *    de Tailscale s'il est installé.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const PORT = process.env.PORT || "3000";
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

/** Ce qui, en changeant, rend le build périmé. */
const SOURCES = ["src", "public", "package.json", "next.config.ts", "postcss.config.mjs"];

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const amber = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

// ── 1. Garde-fou ──────────────────────────────────────────────────────
// On relit `.env.local` nous-mêmes : le drapeau doit être connu **avant**
// de lancer Next. Le lire au moment où Next le charge serait trop tard, le
// port serait déjà ouvert.
function authDisabledFrom() {
  if (process.env.AUTH_DISABLED === "1") return "l'environnement du shell";
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return null;
  const active = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .some((line) => /^\s*AUTH_DISABLED\s*=\s*1\s*$/.test(line));
  return active ? ".env.local" : null;
}

const source = authDisabledFrom();
if (source) {
  console.error(
    "\n" +
      red("  ✗ Démarrage refusé, l'authentification est désactivée.") +
      "\n\n" +
      `    AUTH_DISABLED=1 vient de ${source}.\n` +
      "    Dans cet état l'app n'a aucun contrôle d'accès : la poser sur le\n" +
      "    réseau reviendrait à publier les rushs et les notes.\n\n" +
      "    Repasse la ligne à 0 dans .env.local, puis relance.\n",
  );
  process.exit(1);
}

// ── 2. Build à jour ───────────────────────────────────────────────────
function newestMtime(relative) {
  const full = path.join(ROOT, relative);
  if (!existsSync(full)) return 0;
  const info = statSync(full);
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = info.mtimeMs;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const child = newestMtime(path.join(relative, entry.name));
    if (child > newest) newest = child;
  }
  return newest;
}

const buildId = path.join(ROOT, ".next", "BUILD_ID");
const builtAt = existsSync(buildId) ? statSync(buildId).mtimeMs : 0;
const changedAt = Math.max(...SOURCES.map(newestMtime));

if (builtAt === 0 || changedAt > builtAt) {
  console.log(
    "\n  " +
      (builtAt === 0 ? "Aucun build." : "Le code a changé depuis le dernier build.") +
      " Compilation…\n",
  );
  const build = spawnSync(process.execPath, [NEXT_BIN, "build"], {
    stdio: "inherit",
    cwd: ROOT,
  });
  if (build.status !== 0) {
    console.error(red("\n  ✗ La compilation a échoué, rien n'a été démarré.\n"));
    process.exit(build.status ?? 1);
  }
}

// ── Restes d'envois interrompus ───────────────────────────────────────
// Un envoi s'écrit en `.part` et n'est renommé qu'une fois validé. Le serveur
// n'est pas encore lancé : tout `.part` présent ici est un envoi coupé par un
// arrêt, que plus rien ne finira. Plusieurs gigaoctets, parfois.
const videoDir = path.join(ROOT, "data", "videos");
if (existsSync(videoDir))
  for (const name of readdirSync(videoDir))
    if (name.endsWith(".part")) rmSync(path.join(videoDir, name), { force: true });

// ── 3. Les vraies adresses ────────────────────────────────────────────
function addresses() {
  const found = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      // 169.254.x.x : adresse auto-attribuée quand aucun DHCP n'a répondu.
      // Elle apparaît sur les interfaces inactives, Bluetooth, Ethernet
      // non branché, et ne mène nulle part. L'afficher enverrait Hugo ou
      // Jérôme sur une fausse piste.
      if (net.address.startsWith("169.254.")) continue;
      found.push({
        name,
        address: net.address,
        tailscale: net.address.startsWith("100.") || /tailscale/i.test(name),
      });
    }
  }
  // Tailscale en tête : c'est la seule adresse qui marche aussi hors du bureau.
  return found.sort((a, b) => Number(b.tailscale) - Number(a.tailscale));
}

console.log("");
console.log("  " + bold("Reviewer") + dim("  ·  production"));
console.log("");
console.log("  " + dim("sur ce poste  ") + `http://localhost:${PORT}`);
for (const net of addresses())
  console.log(
    "  " +
      dim(net.tailscale ? "tailscale     " : "réseau        ") +
      amber(`http://${net.address}:${PORT}`) +
      dim(`   (${net.name})`),
  );
console.log("");
console.log(dim("  Ctrl+C pour arrêter. Cette fenêtre doit rester ouverte."));
console.log("");

const server = spawn(process.execPath, [NEXT_BIN, "start", "-H", "0.0.0.0", "-p", PORT], {
  stdio: "inherit",
  cwd: ROOT,
});
server.on("exit", (code) => process.exit(code ?? 0));
