"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  FALLBACK_FPS,
  formatClock,
  formatTimecode,
  frameAt,
  timeOfFrame,
} from "@/lib/timecode";
import {
  FullscreenIcon,
  LoopIcon,
  PauseIcon,
  PlayIcon,
  StepIcon,
  VolumeIcon,
  ZoomIcon,
} from "./player-icons";
import { Timeline, type Marker, type Range } from "./timeline";
import { capturePointer, releasePointer } from "@/lib/pointer";
import { AnnotationLayer, type Tool } from "../annotation/annotation-layer";
import { AnnotationToolbar } from "../annotation/annotation-toolbar";
import type { Annotation } from "@/lib/annotation";

const RATES = [0.25, 0.5, 1, 1.5, 2] as const;
const ZOOMS = [1, 1.5, 2, 3, 4] as const;
const VOLUME_KEY = "reviewer:volume";
const TC_MODE_KEY = "reviewer:tcMode";

/** Les trois lectures d'une même position, comme sur un enregistreur. */
const TC_MODES = ["timecode", "images", "secondes"] as const;
type TcMode = (typeof TC_MODES)[number];

/** Ce que le panneau de commentaires pilotera au lot 5. */
export type PlayerHandle = {
  seekTo: (time: number) => void;
  pause: () => void;
  getCurrentTime: () => number;
};

type Props = {
  videoId: string;
  duration: number | null;
  fps: number | null;
  markers?: Marker[];
  activeMarkerId?: string | null;
  onTimeChange?: (time: number) => void;
  /** Outil d'annotation actif, piloté depuis l'espace de review. */
  tool?: Tool;
  onToolChange?: (tool: Tool) => void;
  draft?: Annotation | null;
  onDraftChange?: (annotation: Annotation | null) => void;
  /** Annotation de la note sous la tête de lecture, en lecture seule. */
  shownAnnotation?: Annotation | null;
  /** Couleur des tracés : celle de l'auteur de ce qui est affiché. */
  annotationColor?: string;
  /** Plage en cours de composition dans le formulaire de note. */
  range?: Range | null;
  rangeArmed?: boolean;
  onRangeChange?: (range: Range | null) => void;
  onRangeDone?: () => void;
  ref?: React.Ref<PlayerHandle>;
};

/** Ne pas voler les touches pendant qu'on écrit un commentaire. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function VideoPlayer({
  videoId,
  duration: initialDuration,
  fps: rawFps,
  markers = [],
  activeMarkerId = null,
  onTimeChange,
  tool = "none",
  onToolChange,
  draft = null,
  onDraftChange,
  shownAnnotation = null,
  annotationColor,
  range = null,
  rangeArmed = false,
  onRangeChange,
  onRangeDone,
  ref,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  /** Dernière position demandée pendant un glissement, pas encore servie. */
  const pendingSeek = useRef<number | null>(null);

  const [duration, setDuration] = useState(initialDuration ?? 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffered, setBuffered] = useState<[number, number][]>([]);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState<number>(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [loop, setLoop] = useState(false);
  const [tcMode, setTcMode] = useState<TcMode>("timecode");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  const fps = rawFps && rawFps > 0 ? rawFps : null;
  const stepFps = fps ?? FALLBACK_FPS;

  /**
   * Déplacement maximal, en pourcentage de la largeur : au-delà, on
   * découvrirait du vide sur un bord de l'image.
   */
  const panLimit = zoom > 1 ? ((zoom - 1) / (2 * zoom)) * 100 : 0;

  const clampPan = useCallback(
    (next: { x: number; y: number }) => ({
      x: Math.min(panLimit, Math.max(-panLimit, next.x)),
      y: Math.min(panLimit, Math.max(-panLimit, next.y)),
    }),
    [panLimit],
  );

  const changeZoom = useCallback((next: number) => {
    const level = Math.min(4, Math.max(1, next));
    setZoom(level);
    // Revenir à 100 % recentre : sinon l'image reste décalée sans qu'on
    // puisse la remettre droite.
    if (level === 1) setPan({ x: 0, y: 0 });
  }, []);

  const publishTime = useCallback(
    (time: number) => {
      setCurrentTime(time);
      onTimeChange?.(time);
    },
    [onTimeChange],
  );

  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const limit = duration || video.duration || 0;
      const clamped = Math.min(Math.max(0, time), limit);
      // Un saut franc annule ce qu'un glissement avait laissé en attente :
      // sinon `seeked` resservait l'ancienne position par-dessus la nouvelle.
      pendingSeek.current = null;
      video.currentTime = clamped;
      publishTime(clamped);
    },
    [duration, publishTime],
  );

  /**
   * Déplacement **continu**, pour un glissement sur la piste.
   *
   * Une main qui glisse produit soixante positions par seconde ; le décodeur
   * en sert deux ou trois. Affecter `currentTime` à chaque déplacement
   * annulait la recherche en cours avant qu'elle n'aboutisse : le grand
   * lecteur restait figé sur l'image de départ pendant tout le geste, et ne
   * rattrapait qu'au relâchement. On ne garde donc qu'une seule demande en
   * attente, toujours la plus récente, et on la sert quand la précédente
   * a abouti (`seeked`). Le décodeur travaille en continu au lieu de
   * repartir de zéro, et l'image suit le curseur.
   *
   * Le timecode affiché, lui, est publié tout de suite : il n'attend pas le
   * décodage et c'est lui qu'on lit pour viser.
   */
  const scrubTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const limit = duration || video.duration || 0;
      const clamped = Math.min(Math.max(0, time), limit);

      publishTime(clamped);

      if (video.seeking) {
        pendingSeek.current = clamped;
        return;
      }
      pendingSeek.current = null;
      video.currentTime = clamped;
    },
    [duration, publishTime],
  );

  /** Image par image : on met en pause, sinon la lecture reprend aussitôt. */
  const stepFrames = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      const target = frameAt(video.currentTime, stepFps) + delta;
      seekTo(timeOfFrame(Math.max(0, target), stepFps));
    },
    [seekTo, stepFps],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, []);

  const toggleFullscreen = useCallback(() => {
    // Sur l'enveloppe et non la vidéo : sinon les contrôles disparaissent
    // en plein écran.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void shellRef.current?.requestFullscreen().catch(() => {});
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      seekTo,
      pause: () => videoRef.current?.pause(),
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    }),
    [seekTo],
  );

  // Volume mémorisé par navigateur : un réglage par personne, pas partagé.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VOLUME_KEY);
      if (saved === null) return;
      const value = Number(saved);
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        setVolume(value);
        if (videoRef.current) videoRef.current.volume = value;
      }
    } catch {
      // Stockage indisponible (navigation privée) : volume par défaut.
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const readBuffered = () => {
      const ranges: [number, number][] = [];
      for (let i = 0; i < video.buffered.length; i += 1)
        ranges.push([video.buffered.start(i), video.buffered.end(i)]);
      setBuffered(ranges);
    };

    const onMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      readBuffered();
    };
    const onTime = () => publishTime(video.currentTime);
    // Fin d'une recherche : s'il en reste une en attente, on la sert
    // maintenant plutôt que de publier une position déjà dépassée.
    const onSeeked = () => {
      const target = pendingSeek.current;
      if (target !== null) {
        pendingSeek.current = null;
        video.currentTime = target;
        return;
      }
      publishTime(video.currentTime);
    };
    const onPlay = () => {
      setPlaying(true);
      setHasPlayed(true);
    };
    const onPause = () => setPlaying(false);
    const onVolume = () => {
      setMuted(video.muted);
      setVolume(video.volume);
    };
    const onRate = () => setRate(video.playbackRate);
    const onError = () =>
      setError("Lecture impossible. Le fichier est peut-être introuvable sur le serveur.");

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("progress", readBuffered);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("ratechange", onRate);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("progress", readBuffered);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("ratechange", onRate);
      video.removeEventListener("error", onError);
    };
  }, [publishTime]);

  /**
   * `timeupdate` ne se déclenche que ~4 fois par seconde : le timecode
   * sauterait de 6 images en 6 images. On suit donc l'image réellement
   * présentée quand le navigateur le permet, sinon on interroge à chaque
   * rafraîchissement d'écran.
   */
  useEffect(() => {
    if (!playing) return;
    const video = videoRef.current as FrameCallbackVideo | null;
    if (!video) return;

    let active = true;

    if (typeof video.requestVideoFrameCallback === "function") {
      let handle = 0;
      const tick = (_now: number, meta: { mediaTime: number }) => {
        if (!active) return;
        publishTime(meta.mediaTime);
        handle = video.requestVideoFrameCallback!(tick);
      };
      handle = video.requestVideoFrameCallback(tick);
      return () => {
        active = false;
        video.cancelVideoFrameCallback?.(handle);
      };
    }

    let raf = 0;
    const loop = () => {
      if (!active) return;
      publishTime(video.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, [playing, publishTime]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TC_MODE_KEY);
      if (saved && (TC_MODES as readonly string[]).includes(saved))
        setTcMode(saved as TcMode);
    } catch {
      // Sans stockage, on reste sur le timecode.
    }
  }, []);

  function cycleTcMode() {
    const next = TC_MODES[(TC_MODES.indexOf(tcMode) + 1) % TC_MODES.length];
    setTcMode(next);
    try {
      localStorage.setItem(TC_MODE_KEY, next);
    } catch {
      // Non bloquant.
    }
  }

  // `loop` est un attribut du média : on le pose sur l'élément lui-même.
  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = loop;
  }, [loop]);

  // On annote un arrêt sur image, pas un plan qui défile.
  useEffect(() => {
    if (tool !== "none") videoRef.current?.pause();
  }, [tool]);

  // Choisir un intervalle demande de viser deux images : la lecture doit
  // s'arrêter, sinon le film avance sous le curseur pendant le geste.
  useEffect(() => {
    if (rangeArmed) videoRef.current?.pause();
  }, [rangeArmed]);

  // Ctrl + molette : le geste attendu pour zoomer, et il ne vole pas le
  // défilement de la page quand on ne presse pas Ctrl.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      changeZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
    }

    video.addEventListener("wheel", onWheel, { passive: false });
    return () => video.removeEventListener("wheel", onWheel);
  }, [zoom, changeZoom]);

  // Le recadrage se resserre quand on dézoome, sinon l'image sortirait.
  useEffect(() => {
    setPan((current) => clampPan(current));
  }, [clampPan]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const video = videoRef.current;
      if (!video) return;

      switch (event.key) {
        case " ":
        case "k":
        case "K":
          event.preventDefault();
          togglePlay();
          return;
        case "ArrowLeft":
          event.preventDefault();
          if (event.shiftKey) seekTo(video.currentTime - 1);
          else stepFrames(-1);
          return;
        case "ArrowRight":
          event.preventDefault();
          if (event.shiftKey) seekTo(video.currentTime + 1);
          else stepFrames(1);
          return;
        case ",":
          event.preventDefault();
          stepFrames(-1);
          return;
        case ".":
          event.preventDefault();
          stepFrames(1);
          return;
        case "j":
        case "J":
          event.preventDefault();
          seekTo(video.currentTime - 1);
          return;
        case "l":
        case "L":
          event.preventDefault();
          seekTo(video.currentTime + 1);
          return;
        case "Home":
          event.preventDefault();
          seekTo(0);
          return;
        case "End":
          event.preventDefault();
          seekTo(duration);
          return;
        case "m":
        case "M":
          event.preventDefault();
          video.muted = !video.muted;
          return;
        case "f":
        case "F":
          event.preventDefault();
          toggleFullscreen();
          return;
        case "r":
        case "R":
          event.preventDefault();
          setLoop((v) => !v);
          return;
        default:
          break;
      }

      if (/^[0-9]$/.test(event.key) && duration > 0) {
        event.preventDefault();
        seekTo((Number(event.key) / 10) * duration);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration, seekTo, stepFrames, togglePlay, toggleFullscreen]);

  function changeVolume(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value === 0;
    try {
      localStorage.setItem(VOLUME_KEY, String(value));
    } catch {
      // Sans stockage, le volume repart à 1 au prochain chargement.
    }
  }

  const frame = frameAt(currentTime, stepFps);
  const totalFrames = duration > 0 ? frameAt(duration, stepFps) : 0;

  const readout =
    tcMode === "images"
      ? { value: String(frame), total: String(totalFrames) }
      : tcMode === "secondes"
        ? { value: currentTime.toFixed(2), total: duration.toFixed(2) }
        : { value: formatTimecode(currentTime, fps), total: formatClock(duration) };

  return (
    <div
      ref={shellRef}
      className="overflow-hidden rounded-lg border border-line bg-black"
    >
      <div className="relative overflow-hidden">
        {/* Enveloppe de zoom : la vidéo et le calque de dessin sont
            transformés ensemble, sinon les annotations se décrocheraient
            de l'image dès qu'on agrandit. */}
        <div
          className="relative origin-center"
          style={{
            transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%)`,
            transition: dragRef.current ? "none" : "transform 120ms ease-out",
          }}
          onPointerDown={(event) => {
            if (zoom === 1 || tool !== "none") return;
            capturePointer(event.currentTarget, event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY };
            movedRef.current = false;
          }}
          onPointerMove={(event) => {
            const start = dragRef.current;
            if (!start) return;
            const box = event.currentTarget.getBoundingClientRect();
            const dx = ((event.clientX - start.x) / box.width) * 100;
            const dy = ((event.clientY - start.y) / box.height) * 100;
            if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 3)
              movedRef.current = true;
            dragRef.current = { x: event.clientX, y: event.clientY };
            setPan((current) => clampPan({ x: current.x + dx, y: current.y + dy }));
          }}
          onPointerUp={(event) => {
            releasePointer(event.currentTarget, event.pointerId);
            dragRef.current = null;
          }}
        >
          <video
            ref={videoRef}
            src={`/api/videos/${videoId}/stream`}
            preload="metadata"
            playsInline
            onClick={() => {
              // Un glissement pour recadrer ne doit pas lancer la lecture.
              if (movedRef.current) {
                movedRef.current = false;
                return;
              }
              if (tool === "none") togglePlay();
            }}
            onDoubleClick={tool === "none" && zoom === 1 ? toggleFullscreen : undefined}
            className={`player-picture block w-full bg-black ${
              tool !== "none"
                ? "cursor-crosshair"
                : zoom > 1
                  ? "cursor-grab active:cursor-grabbing"
                  : "cursor-pointer"
            }`}
          />

          {onDraftChange && (
            <AnnotationLayer
              videoRef={videoRef}
              tool={tool}
              draft={draft}
              onDraftChange={onDraftChange}
              shown={shownAnnotation}
              color={annotationColor}
            />
          )}
        </div>

        {tool !== "none" && onToolChange && onDraftChange && (
          <AnnotationToolbar
            tool={tool}
            onToolChange={onToolChange}
            draft={draft}
            onDraftChange={onDraftChange}
          />
        )}

        {/* Le pavé de lecture ne s'affiche qu'avant le premier démarrage :
            en review on met en pause pour examiner une image, et un bouton
            au centre masquerait précisément ce qu'on regarde. Ensuite, un
            clic sur la vidéo suffit. */}
        {!hasPlayed && !playing && !error && tool === "none" && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Lecture"
            className="absolute inset-0 grid place-items-center"
          >
            <span className="grid size-14 place-items-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-sm transition-colors hover:border-accent/60 hover:bg-black/75">
              <PlayIcon className="ml-0.5 size-7" />
            </span>
          </button>
        )}

        {error && (
          <p
            role="alert"
            className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-status-changes"
          >
            {error}
          </p>
        )}
      </div>

      {/* Conteneur de requête : la barre se replie selon la largeur de sa
          colonne, pas celle de la fenêtre. La même barre est à l'étroit à
          1024 px en deux colonnes et au large à 960 px en une seule -
          un point de rupture sur la fenêtre se tromperait dans les deux
          sens. */}
      <div className="@container border-t border-line bg-surface px-3 pb-2.5">
        <Timeline
          videoId={videoId}
          duration={duration}
          currentTime={currentTime}
          buffered={buffered}
          markers={markers}
          activeMarkerId={activeMarkerId}
          onSeek={seekTo}
          onScrub={scrubTo}
          range={range}
          rangeArmed={rangeArmed}
          onRangeChange={onRangeChange}
          onRangeDone={onRangeDone}
        />

        {/* Sous 660 px la rangée passe sur deux lignes plutôt que de laisser
            le groupe de droite, zoom, volume, vitesse, plein écran, se
            faire couper : ces contrôles sortaient du cadre entre 1024 et
            1056 px, juste au passage en deux colonnes. */}
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 @min-[660px]:grid-cols-[1fr_auto_1fr]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Lecture"}
              title="Lecture / pause (Espace)"
              className="rounded-sm p-1.5 text-fg transition-colors hover:bg-surface-3"
            >
              {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
            </button>

            <button
              type="button"
              onClick={() => stepFrames(-1)}
              aria-label="Image précédente"
              title="Image précédente (flèche gauche)"
              className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
            >
              <StepIcon back className="size-4.5" />
            </button>
            <button
              type="button"
              onClick={() => stepFrames(1)}
              aria-label="Image suivante"
              title="Image suivante (flèche droite)"
              className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
            >
              <StepIcon className="size-4.5" />
            </button>

            <button
              type="button"
              onClick={() => setLoop((v) => !v)}
              aria-pressed={loop}
              aria-label="Lecture en boucle"
              title="Lecture en boucle (R)"
              className={`rounded-sm p-1.5 transition-colors hover:bg-surface-3 ${
                loop ? "text-accent" : "text-muted hover:text-fg"
              }`}
            >
              <LoopIcon className="size-4.5" />
            </button>
          </div>

          {/* Afficheur central. Un clic change de lecture : timecode,
              numéro d'image ou secondes, chacun a sa préférence. */}
          <button
            type="button"
            onClick={cycleTcMode}
            title={`Affichage : ${tcMode}, cliquer pour changer`}
            className="tc-plate justify-self-end text-[13px] transition-colors hover:border-line-strong @min-[660px]:justify-self-center"
          >
            <span className="text-accent">{readout.value}</span>
            <span className="text-[11px] text-muted">/ {readout.total}</span>
          </button>

          <div className="col-span-2 flex items-center justify-end gap-1.5 @min-[660px]:col-span-1">
            <div className="mr-1 flex items-center">
              <button
                type="button"
                onClick={() => changeZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom as never) - 1)] ?? zoom / 1.5)}
                disabled={zoom <= 1}
                aria-label="Dézoomer"
                title="Dézoomer (Ctrl + molette)"
                className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-35"
              >
                <ZoomIcon out className="size-4.5" />
              </button>
              <button
                type="button"
                onClick={() => changeZoom(1)}
                title="Revenir à 100 %"
                className={`min-w-11 rounded-sm px-1 py-1 font-mono text-[11px] tabular-nums transition-colors hover:bg-surface-3 ${
                  zoom > 1 ? "text-accent" : "text-muted"
                }`}
              >
                {Math.round(zoom * 100)} %
              </button>
              <button
                type="button"
                onClick={() => changeZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom as never) + 1)] ?? zoom * 1.5)}
                disabled={zoom >= 4}
                aria-label="Zoomer"
                title="Zoomer (Ctrl + molette)"
                className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-35"
              >
                <ZoomIcon className="size-4.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (video) video.muted = !video.muted;
              }}
              aria-label={muted ? "Réactiver le son" : "Couper le son"}
              title="Couper le son (M)"
              className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
            >
              <VolumeIcon muted={muted || volume === 0} className="size-4.5" />
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label="Volume"
              className="w-14 accent-[var(--color-accent)]"
            />

            <select
              value={rate}
              onChange={(e) => {
                const video = videoRef.current;
                if (video) video.playbackRate = Number(e.target.value);
              }}
              aria-label="Vitesse de lecture"
              className="rounded-sm border border-line bg-surface-3 px-1.5 py-1 font-mono text-[11px] text-fg-dim"
            >
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Quitter le plein écran" : "Plein écran"}
              title="Plein écran (F)"
              className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
            >
              <FullscreenIcon exit={fullscreen} className="size-4.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
