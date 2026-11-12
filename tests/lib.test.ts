// Tests des modules sans dépendance, ceux où une erreur d'une unité se paie
// en image décalée ou en accès ouvert. `npm test`, sans rien installer :
// Node exécute le TypeScript directement.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeAnnotation, MAX_POINTS, MAX_SHAPES } from "../src/lib/annotation.ts";
import { parseRange } from "../src/lib/http-range.ts";
import { scopeAllowsFolder, scopeAllowsVideo, type Scope } from "../src/lib/scope.ts";
import { formatTimecode, frameAt, timeOfFrame } from "../src/lib/timecode.ts";

test("timecode : une image visée retombe sur elle-même", () => {
  for (const fps of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60])
    for (const frame of [0, 1, 23, 24, 1000, 86399])
      assert.equal(frameAt(timeOfFrame(frame, fps), fps), frame, `${frame} @ ${fps}`);
});

test("timecode : l'arrondi flottant ne recule pas d'une image", () => {
  assert.equal(frameAt(0.99999999, 25), 25);
  assert.equal(formatTimecode(10, 23.976), "00:00:10:00");
  assert.equal(formatTimecode(3661.5, 24), "01:01:01:12");
  assert.equal(formatTimecode(1.5, null), "00:00:01.50");
  assert.equal(formatTimecode(Number.NaN, 25), "00:00:00:00");
});

test("range : formes valides", () => {
  assert.deepEqual(parseRange("bytes=0-1023", 5000), { start: 0, end: 1023 });
  assert.deepEqual(parseRange("bytes=500-", 5000), { start: 500, end: 4999 });
  assert.deepEqual(parseRange("bytes=-500", 5000), { start: 4500, end: 4999 });
  assert.deepEqual(parseRange("bytes=0-99999", 5000), { start: 0, end: 4999 });
  assert.deepEqual(parseRange("bytes=-99999", 5000), { start: 0, end: 4999 });
});

test("range : tout le reste est refusé", () => {
  for (const header of ["bytes=-", "bytes=5000-", "bytes=10-5", "bytes=-0", "octets=0-1", "bytes=0-1,5-9", "bytes=a-b"])
    assert.equal(parseRange(header, 5000), null, header);
  assert.equal(parseRange("bytes=0-", 0), null);
});

test("portée : null ouvre tout, un ensemble vide n'ouvre rien", () => {
  const video = { id: "v", folderId: "f" };
  assert.equal(scopeAllowsFolder(null, null), true);
  assert.equal(scopeAllowsVideo(null, video), true);

  const empty: Scope = { roots: [], visible: new Set(), videos: new Set() };
  assert.equal(scopeAllowsFolder(empty, null), false);
  assert.equal(scopeAllowsFolder(empty, "f"), false);
  assert.equal(scopeAllowsVideo(empty, video), false);
  assert.equal(scopeAllowsVideo(empty, { id: "v", folderId: null }), false);
});

test("portée : une vidéo partagée seule n'ouvre pas son dossier", () => {
  const scope: Scope = { roots: [], visible: new Set(), videos: new Set(["v"]) };
  assert.equal(scopeAllowsVideo(scope, { id: "v", folderId: "f" }), true);
  assert.equal(scopeAllowsVideo(scope, { id: "autre", folderId: "f" }), false);
  assert.equal(scopeAllowsFolder(scope, "f"), false);
});

test("annotation : rien de ce qui vient du navigateur n'est cru", () => {
  assert.equal(sanitizeAnnotation(null), null);
  assert.equal(sanitizeAnnotation({ shapes: "x" }), null);
  assert.equal(sanitizeAnnotation({ shapes: [{ t: "inconnu" }, { t: "pin", x: Number.NaN, y: 0 }] }), null);

  assert.deepEqual(sanitizeAnnotation({ shapes: [{ t: "pin", x: 2, y: -1, parasite: 1 }] }), {
    shapes: [{ t: "pin", x: 1, y: 0 }],
  });
  // Formes dégénérées : un clic manqué n'est pas une intention.
  assert.equal(sanitizeAnnotation({ shapes: [{ t: "rect", x: 0.1, y: 0.1, w: 0.001, h: 0.5 }] }), null);
  assert.equal(sanitizeAnnotation({ shapes: [{ t: "arrow", x1: 0.5, y1: 0.5, x2: 0.501, y2: 0.5 }] }), null);
  assert.equal(sanitizeAnnotation({ shapes: [{ t: "free", pts: [[0.1, 0.1]] }] }), null);
  // Un cadre ne déborde pas de l'image.
  assert.deepEqual(sanitizeAnnotation({ shapes: [{ t: "rect", x: 0.8, y: 0.8, w: 0.9, h: 0.9 }] })?.shapes[0], {
    t: "rect", x: 0.8, y: 0.8, w: 1 - 0.8, h: 1 - 0.8,
  });
});

test("annotation : plafonds", () => {
  const pins = Array.from({ length: MAX_SHAPES + 10 }, () => ({ t: "pin", x: 0.5, y: 0.5 }));
  assert.equal(sanitizeAnnotation({ shapes: pins })?.shapes.length, MAX_SHAPES);

  const pts = Array.from({ length: MAX_POINTS + 50 }, (_, i) => [i / 1000, 0.5]);
  const free = sanitizeAnnotation({ shapes: [{ t: "free", pts }] })?.shapes[0];
  assert.equal(free?.t === "free" && free.pts.length, MAX_POINTS);
});
