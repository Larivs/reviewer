// Pas de garde "server-only" ici : `node:child_process` rend déjà tout
// usage côté client impossible, et ce module reste testable en isolation.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const run = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string;
const FFPROBE = ffprobeStatic.path;


/**
 * Codecs que les navigateurs savent décoder. Volontairement restrictif :
 * mieux vaut refuser à l'upload que livrer une vidéo qui ne se lira pas.
 * HEVC est exclu, son support dépend de l'OS et du navigateur.
 */
const VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);
/** Familles de conteneurs telles que ffprobe les nomme. */
const CONTAINERS = ["mp4", "webm", "matroska"];

export type Probe = {
  duration: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string;
  width: number | null;
  height: number | null;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  width?: number;
  height?: number;
};

/** ffprobe donne les cadences en fraction ("30000/1001"). */
function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return null;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : null;
}

export async function probe(filePath: string): Promise<Probe> {
  const { stdout } = await run(
    FFPROBE,
    [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
  );

  const data = JSON.parse(stdout) as {
    streams?: FfprobeStream[];
    format?: { duration?: string; format_name?: string };
  };

  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  const duration = Number(data.format?.duration ?? video?.duration);

  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    container: data.format?.format_name ?? "",
    width: video?.width ?? null,
    height: video?.height ?? null,
  };
}

/**
 * Vérifie que le navigateur pourra lire le fichier, et explique quoi faire
 * sinon, un message vague enverrait le monteur ré-exporter au hasard.
 */
export function playbackProblem(p: Probe): string | null {
  if (!p.videoCodec) return "Ce fichier ne contient pas de piste vidéo.";

  const containerOk = CONTAINERS.some((c) => p.container.includes(c));
  if (!containerOk)
    return `Conteneur « ${p.container || "inconnu"} » non lisible en navigateur. Réexporte en MP4.`;

  if (!VIDEO_CODECS.has(p.videoCodec))
    return `Codec vidéo « ${p.videoCodec} » non lisible en navigateur. Réexporte en H.264 (MP4).`;

  if (p.audioCodec && !AUDIO_CODECS.has(p.audioCodec))
    return `Codec audio « ${p.audioCodec} » non lisible en navigateur. Réexporte l'audio en AAC.`;

  return null;
}

/**
 * Convertit en H.264 / AAC ce que le navigateur ne lit pas : ProRes, DNxHD,
 * HEVC, audio PCM. C'est un proxy de review, pas un master : `veryfast` et
 * CRF 20 donnent une image propre sans monopoliser la machine qui sert aussi
 * la lecture aux autres.
 *
 * Les dimensions sont ramenées au pair, que libx264 exige en 4:2:0, et
 * `faststart` place l'index en tête pour que la lecture démarre sans avoir
 * à télécharger la fin du fichier. Pas de délai maximal : un long métrage en
 * ProRes prend le temps qu'il prend.
 */
export async function transcode(inputPath: string, outputPath: string) {
  await run(
    FFMPEG,
    [
      "-i", inputPath,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-f", "mp4",
      "-y",
      outputPath,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

/**
 * File unique pour les travaux lourds de ffmpeg, conversions et planches.
 * Un seul à la fois : chacun décode tout le métrage, et dix envois à la
 * suite en lanceraient dix de front. Posée sur `globalThis` pour rester
 * unique même si ce module est chargé par plusieurs paquets serveur.
 */
const jobs = globalThis as unknown as { __reviewerMediaQueue?: Promise<void> };

export function enqueueMediaJob(job: () => Promise<void>) {
  const next = (jobs.__reviewerMediaQueue ?? Promise.resolve()).then(() =>
    job().catch(() => {}),
  );
  jobs.__reviewerMediaQueue = next;
  return next;
}

/** Planche d'aperçu : 10 × 10 images réparties sur tout le métrage. */
export const SPRITE_COLS = 10;
export const SPRITE_ROWS = 10;
const SPRITE_COUNT = SPRITE_COLS * SPRITE_ROWS;
const SPRITE_TILE_WIDTH = 160;

/**
 * Planche de vignettes pour l'aperçu au survol de la piste. Une seule image
 * plutôt que cent requêtes : le navigateur la charge une fois et se
 * contente ensuite de décaler l'arrière-plan.
 */
export async function makeSprite(
  filePath: string,
  outPath: string,
  duration: number | null,
) {
  if (!duration || duration <= 0) throw new Error("Durée inconnue");

  await run(
    FFMPEG,
    [
      "-i", filePath,
      // Une cadence calculée pour tomber sur exactement 100 images, quelle
      // que soit la durée du plan.
      "-vf",
      `fps=${(SPRITE_COUNT / duration).toFixed(6)},scale=${SPRITE_TILE_WIDTH}:-2,tile=${SPRITE_COLS}x${SPRITE_ROWS}`,
      "-frames:v", "1",
      "-q:v", "8",
      "-y",
      outPath,
    ],
    { timeout: 300_000 },
  );
}

/**
 * Vignette prise à 10 % de la durée : la première image est souvent noire
 * ou un fondu d'ouverture.
 */
export async function makeThumbnail(
  filePath: string,
  outPath: string,
  duration: number | null,
) {
  const at = duration ? Math.min(duration * 0.1, 5) : 1;
  await run(
    FFMPEG,
    [
      // -ss avant -i : ffmpeg saute directement au bon endroit au lieu de
      // décoder tout ce qui précède.
      "-ss", at.toFixed(3),
      "-i", filePath,
      "-frames:v", "1",
      "-vf", "scale=640:-2",
      "-q:v", "4",
      "-y",
      outPath,
    ],
    { timeout: 120_000 },
  );
}
