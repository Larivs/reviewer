"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FALLBACK_FPS, formatTimecode, frameAt, timeOfFrame } from "@/lib/timecode";
import { capturePointer, releasePointer } from "@/lib/pointer";
import { PauseIcon, PlayIcon, StepIcon } from "./player/player-icons";

export type CompareSide = {
  id: string;
  label: string;
  duration: number | null;
  fps: number | null;
};

type Mode = "cote" | "volet";

/** Au-delà, les deux images ne montrent plus le même instant : on recale. */
const DRIFT = 0.06;

/**
 * Deux versions, une seule tête de lecture.
 *
 * La gauche mène : c'est son horloge qui fait foi, la droite est recalée
 * dessus. Deux lecteurs lancés ensemble ne restent pas ensemble, chacun
 * tamponne à son rythme, et une demi-image d'écart suffit à faire croire à
 * une différence de montage qui n'existe pas.
 *
 * Deux façons de regarder : **côte à côte**, pour suivre les deux, et le
 * **volet**, une image par-dessus l'autre avec une séparation qu'on déplace.
 * Le volet est celui qui tranche : on le pose sur le raccord corrigé et on
 * voit, au pixel, ce qui a bougé.
 */
export function CompareView({ a, b }: { a: CompareSide; b: CompareSide }) {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [mode, setMode] = useState<Mode>("cote");
  const [split, setSplit] = useState(0.5);
  const [audio, setAudio] = useState<"a" | "b">("b");
  const [duration, setDuration] = useState(Math.max(a.duration ?? 0, b.duration ?? 0));

  /** Position à retrouver quand un changement d'affichage remonte les lecteurs. */
  const timeRef = useRef(0);
  timeRef.current = time;

  const fps = a.fps ?? b.fps ?? null;
  const stepFps = fps ?? FALLBACK_FPS;

  const seek = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(0, next), duration || 0);
      for (const video of [aRef.current, bRef.current])
        if (video) video.currentTime = Math.min(clamped, video.duration || clamped);
      setTime(clamped);
    },
    [duration],
  );

  const toggle = useCallback(() => {
    const lead = aRef.current;
    const follow = bRef.current;
    if (!lead || !follow) return;
    if (lead.paused) {
      follow.currentTime = lead.currentTime;
      void lead.play().catch(() => {});
      void follow.play().catch(() => {});
    } else {
      lead.pause();
      follow.pause();
    }
  }, []);

  const step = useCallback(
    (delta: number) => {
      const lead = aRef.current;
      if (!lead) return;
      lead.pause();
      bRef.current?.pause();
      seek(timeOfFrame(Math.max(0, frameAt(lead.currentTime, stepFps) + delta), stepFps));
    },
    [seek, stepFps],
  );

  // La gauche publie le temps, et la droite est recalée dès qu'elle s'écarte.
  useEffect(() => {
    const lead = aRef.current;
    const follow = bRef.current;
    if (!lead || !follow) return;

    const onTime = () => {
      setTime(lead.currentTime);
      if (!lead.paused && Math.abs(follow.currentTime - lead.currentTime) > DRIFT)
        follow.currentTime = lead.currentTime;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      follow.pause();
    };
    const onMeta = (event: Event) => {
      setDuration(Math.max(lead.duration || 0, follow.duration || 0));
      // Passer du côte à côte au volet remonte les deux lecteurs : chacun
      // reprend où on en était au lieu de repartir du début.
      const video = event.currentTarget as HTMLVideoElement;
      if (timeRef.current > 0) video.currentTime = Math.min(timeRef.current, video.duration || 0);
    };
    // Si la gauche attend ses données, la droite attend avec elle.
    const onWaiting = () => follow.pause();
    const onPlaying = () => void follow.play().catch(() => {});

    lead.addEventListener("timeupdate", onTime);
    lead.addEventListener("seeked", onTime);
    lead.addEventListener("play", onPlay);
    lead.addEventListener("pause", onPause);
    lead.addEventListener("ended", onPause);
    lead.addEventListener("waiting", onWaiting);
    lead.addEventListener("playing", onPlaying);
    lead.addEventListener("loadedmetadata", onMeta);
    follow.addEventListener("loadedmetadata", onMeta);
    return () => {
      lead.removeEventListener("timeupdate", onTime);
      lead.removeEventListener("seeked", onTime);
      lead.removeEventListener("play", onPlay);
      lead.removeEventListener("pause", onPause);
      lead.removeEventListener("ended", onPause);
      lead.removeEventListener("waiting", onWaiting);
      lead.removeEventListener("playing", onPlaying);
      lead.removeEventListener("loadedmetadata", onMeta);
      follow.removeEventListener("loadedmetadata", onMeta);
    };
    // `mode` : les éléments vidéo ne sont pas les mêmes d'un affichage à
    // l'autre, les écouteurs doivent suivre.
  }, [mode]);

  // Une seule bande son à la fois : deux versions du même mix jouées
  // ensemble, à quelques millisecondes d'écart, donnent un écho.
  useEffect(() => {
    if (aRef.current) aRef.current.muted = audio !== "a";
    if (bRef.current) bRef.current.muted = audio !== "b";
  }, [audio, mode]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const el = event.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const lead = aRef.current;
      if (!lead) return;
      if (event.key === " " || event.key.toLowerCase() === "k") toggle();
      else if (event.key === "ArrowLeft") event.shiftKey ? seek(lead.currentTime - 1) : step(-1);
      else if (event.key === "ArrowRight") event.shiftKey ? seek(lead.currentTime + 1) : step(1);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seek, step, toggle]);

  function dragSplit(event: React.PointerEvent<HTMLDivElement>) {
    if (event.buttons === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    setSplit(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  }

  const picture = "block w-full bg-black";
  const src = (id: string) => `/api/videos/${id}/stream`;

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line bg-black">
      {mode === "cote" ? (
        <div className="grid grid-cols-2 gap-px bg-line">
          {(
            [
              [a, aRef],
              [b, bRef],
            ] as const
          ).map(([side, ref]) => (
            <div key={side.id} className="relative bg-black">
              <video ref={ref} src={src(side.id)} preload="metadata" playsInline onClick={toggle} className={`${picture} cursor-pointer`} />
              <span className="tc-plate absolute left-2 top-2 !px-1.5 !py-0.5 text-[11px] text-fg-dim">
                {side.label}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="relative cursor-ew-resize touch-none select-none"
          onPointerDown={(e) => {
            capturePointer(e.currentTarget, e.pointerId);
            dragSplit(e);
          }}
          onPointerMove={dragSplit}
          onPointerUp={(e) => releasePointer(e.currentTarget, e.pointerId)}
        >
          <video ref={aRef} src={src(a.id)} preload="metadata" playsInline className={picture} />
          {/* La droite par-dessus, rognée à gauche de la séparation : les
              deux images gardent exactement le même cadre. */}
          <video
            ref={bRef}
            src={src(b.id)}
            preload="metadata"
            playsInline
            className="absolute inset-0 h-full w-full bg-black object-contain"
            style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-fg shadow-[0_0_6px_rgba(0,0,0,0.9)]" style={{ left: `${split * 100}%` }} />
          <span className="tc-plate pointer-events-none absolute left-2 top-2 !px-1.5 !py-0.5 text-[11px] text-fg-dim">{a.label}</span>
          <span className="tc-plate pointer-events-none absolute right-2 top-2 !px-1.5 !py-0.5 text-[11px] text-fg-dim">{b.label}</span>
        </div>
      )}

      <div className="border-t border-line bg-surface px-3 py-2.5">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1 / stepFps}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Position dans les deux vidéos"
          className="w-full accent-[var(--color-accent)]"
        />

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Lecture"} title="Lecture / pause (Espace)" className="rounded-sm p-1.5 text-fg transition-colors hover:bg-surface-3">
              {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
            </button>
            <button type="button" onClick={() => step(-1)} aria-label="Image précédente" title="Image précédente (flèche gauche)" className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg">
              <StepIcon back className="size-4.5" />
            </button>
            <button type="button" onClick={() => step(1)} aria-label="Image suivante" title="Image suivante (flèche droite)" className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg">
              <StepIcon className="size-4.5" />
            </button>
          </div>

          <span className="tc-plate text-[13px]">
            <span className="text-accent">{formatTimecode(time, fps)}</span>
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Segmented
              label="Affichage"
              value={mode}
              onChange={(next) => {
              setPlaying(false);
              setMode(next);
            }}
              options={[
                ["cote", "Côte à côte"],
                ["volet", "Volet"],
              ]}
            />
            <Segmented
              label="Son"
              value={audio}
              onChange={setAudio}
              options={[
                ["a", a.label],
                ["b", b.label],
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="label">{label}</span>
      <div className="flex overflow-hidden rounded-sm border border-line">
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            className={`px-2 py-1 text-[11px] transition-colors ${
              value === key ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
