// Aucune dépendance d'exécution : pur formatage, testé dans `tests/`.
import type { CommentWithAuthor } from "./comments";
import { FALLBACK_FPS, formatTimecode, frameAt } from "./timecode.ts";

/**
 * Sortir les notes de l'app, pour qu'elles arrivent là où le monteur
 * travaille. Trois formes, parce que trois usages :
 *
 * - **XML** : une séquence que Premiere Pro ouvre (Fichier, Importer), avec
 *   une note par marqueur. Le format est celui de Final Cut Pro 7, que
 *   Premiere lit nativement : rien à installer côté montage.
 * - **EDL** : des marqueurs que DaVinci Resolve pose sur la timeline
 *   (clic droit sur la timeline dans le chutier, Timelines, Import,
 *   Timeline Markers from EDL).
 * - **CSV** : un tableur, ou tout outil qui sait lire des colonnes.
 * - **Texte** : à coller dans un message ou à imprimer.
 */
export const EXPORT_FORMATS = ["xml", "edl", "csv", "txt"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_MIME: Record<ExportFormat, string> = {
  xml: "application/xml; charset=utf-8",
  edl: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

const oneLine = (text: string) => text.replace(/\s*\n+\s*/g, " / ").trim();

/**
 * Timecode de timeline : `HH:MM:SS:FF` compté sur la cadence **entière**,
 * avec le départ à une heure. C'est la convention des timelines (23,976
 * s'y compte sur 24, sans saut d'image), et une heure est le départ par
 * défaut de Resolve comme de Premiere.
 */
export function timelineTimecode(time: number, fps: number | null, startHour = 1) {
  const real = fps ?? FALLBACK_FPS;
  const base = Math.round(real);
  const total = frameAt(time, real) + startHour * 3600 * base;
  const pad = (n: number) => String(n).padStart(2, "0");
  const frames = total % base;
  const seconds = Math.floor(total / base);
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}:${pad(frames)}`;
}

export function toEdl(title: string, comments: CommentWithAuthor[], fps: number | null) {
  const real = fps ?? FALLBACK_FPS;
  const lines = [`TITLE: ${oneLine(title)}`, "FCM: NON-DROP FRAME", ""];

  comments.forEach((comment, i) => {
    const start = timelineTimecode(comment.timecode, fps);
    // Un marqueur ponctuel dure une image ; une plage, son intervalle.
    const frames =
      comment.timecodeEnd === null
        ? 1
        : Math.max(1, frameAt(comment.timecodeEnd, real) - frameAt(comment.timecode, real));
    const end = timelineTimecode(comment.timecode + frames / real, fps);
    // `|` sépare les champs d'un marqueur : dans le texte il le couperait.
    const text = oneLine(`${comment.authorName} : ${comment.body}`).replace(/\|/g, "/");
    // La couleur dit où en est la note, le monteur trie dessus.
    const color = comment.resolved ? "ResolveColorGreen" : "ResolveColorBlue";

    lines.push(
      `${String(i + 1).padStart(3, "0")}  001      V     C        ${start} ${end} ${start} ${end}  `,
      ` |C:${color} |M:${text} |D:${frames}`,
      "",
    );
  });

  return lines.join("\n");
}

/** Guillemets doublés, et tout champ entre guillemets : le texte est libre. */
const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export function toCsv(comments: CommentWithAuthor[], fps: number | null) {
  const rows = [
    ["N°", "Timecode", "Fin", "Auteur", "État", "Note", "Réponses"],
    ...comments.map((c, i) => [
      i + 1,
      formatTimecode(c.timecode, fps),
      c.timecodeEnd === null ? "" : formatTimecode(c.timecodeEnd, fps),
      c.authorName,
      c.resolved ? "Résolue" : "Ouverte",
      c.body,
      c.replies.map((r) => `${r.authorName} : ${r.body}`).join("\n"),
    ]),
  ];
  // Point-virgule et BOM : c'est ce qu'Excel attend en français pour ouvrir
  // le fichier d'un double-clic, colonnes et accents en place.
  return "﻿" + rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
}

export function toText(title: string, comments: CommentWithAuthor[], fps: number | null) {
  const open = comments.filter((c) => !c.resolved).length;
  const head = [title, `${comments.length} note(s), ${open} ouverte(s)`, ""];

  const body = comments.flatMap((c, i) => {
    const at =
      c.timecodeEnd === null
        ? formatTimecode(c.timecode, fps)
        : `${formatTimecode(c.timecode, fps)} → ${formatTimecode(c.timecodeEnd, fps)}`;
    return [
      `#${i + 1}  ${at}  ${c.authorName}${c.resolved ? "  [résolue]" : ""}`,
      ...c.body.split("\n").map((line) => `    ${line}`),
      ...c.replies.map((r) => `    ↳ ${r.authorName} : ${oneLine(r.body)}`),
      "",
    ];
  });

  return [...head, ...body].join("\n");
}

const xml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Séquence Premiere dont les marqueurs sont les notes.
 *
 * Les marqueurs d'une séquence se comptent **en images depuis son début**,
 * pas en timecode : pas de départ à une heure à compenser comme pour l'EDL.
 * Les cadences NTSC (23,976, 29,97, 59,94) s'écrivent sur leur base entière
 * avec `ntsc` à vrai, c'est la convention du format.
 *
 * Une note ponctuelle a une sortie à -1, une plage sa dernière image. Les
 * réponses sont jointes au commentaire du marqueur : dans Premiere, le fil
 * n'existe pas, mais le monteur doit lire la conclusion.
 */
export function toPremiereXml(
  title: string,
  comments: CommentWithAuthor[],
  fps: number | null,
  duration: number | null,
) {
  const real = fps ?? FALLBACK_FPS;
  const base = Math.round(real);
  const ntsc = Math.abs(real - base) > 0.001 ? "TRUE" : "FALSE";
  const rate = `<rate><timebase>${base}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const frames = Math.max(1, frameAt(duration ?? 0, real));

  const markers = comments.map((c) => {
    const start = frameAt(c.timecode, real);
    const end = c.timecodeEnd === null ? -1 : Math.max(start + 1, frameAt(c.timecodeEnd, real));
    const thread = [c.body, ...c.replies.map((r) => `${r.authorName} : ${r.body}`)].join("\n");
    return [
      "    <marker>",
      `      <name>${xml(`#${c.number} ${c.authorName}${c.resolved ? " (résolue)" : ""}`)}</name>`,
      `      <comment>${xml(thread)}</comment>`,
      `      <in>${start}</in>`,
      `      <out>${end}</out>`,
      "    </marker>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE xmeml>",
    '<xmeml version="4">',
    "  <sequence>",
    `    <name>${xml(`${title} (notes)`)}</name>`,
    `    <duration>${frames}</duration>`,
    `    ${rate}`,
    "    <timecode>",
    `      ${rate}`,
    "      <string>00:00:00:00</string>",
    "      <frame>0</frame>",
    "      <displayformat>NDF</displayformat>",
    "    </timecode>",
    "    <media>",
    "      <video><track/></video>",
    "      <audio><track/></audio>",
    "    </media>",
    ...markers,
    "  </sequence>",
    "</xmeml>",
    "",
  ].join("\n");
}
