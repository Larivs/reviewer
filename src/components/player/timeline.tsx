"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@/lib/timecode";
import { capturePointer, releasePointer } from "@/lib/pointer";

/** Doit correspondre à la grille produite par `makeSprite`. */
const SPRITE_COLS = 10;
const SPRITE_ROWS = 10;
const PREVIEW_WIDTH = 150;

/** Hauteur d'une rangée de repères, marge comprise. */
const LANE_HEIGHT = 8;
/** Au-delà, on empilerait plus haut que le lecteur ne le supporte. */
const MAX_LANES = 3;
/** Encombrement minimal d'un repère ponctuel, en pixels. */
const MARKER_FOOTPRINT = 11;
/**
 * Rayon d'aimantation autour d'un repère, en pixels. Sept pixels, c'est à
 * peu près la précision d'une main à la souris : en dessous on rate la
 * note d'une image ou deux, ce qui suffit à ne plus voir ce qu'elle
 * désigne. Alt enfoncé, on reprend la main au pixel.
 */
const SNAP_RADIUS = 7;
/**
 * En dessous, on a cliqué, pas glissé : la « plage » ferait deux images et
 * n'aurait aucun sens. On rend alors la main sans rien poser, plutôt que de
 * laisser un intervalle vide que l'utilisateur devrait aller effacer.
 */
const MIN_RANGE = 0.08;

export type Range = { start: number; end: number };

/**
 * Charge la planche d'aperçu, mais **seulement au premier survol** : c'est
 * 180 Ko qu'on ne télécharge pas si personne ne survole la piste. Renvoie
 * ses dimensions natives, dont on déduit le rapport d'une vignette.
 */
function useSprite(videoId: string, wanted: boolean) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!wanted || size || missing) return;
    const img = new Image();
    img.src = `/api/videos/${videoId}/sprite`;
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    // Vidéo envoyée avant l'arrivée de l'aperçu : on n'insiste pas.
    img.onerror = () => setMissing(true);
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [videoId, wanted, size, missing]);

  return size;
}

export type Marker = {
  id: string;
  time: number;
  /** Fin de plage, quand la note couvre un intervalle. */
  end?: number;
  label?: string;
  resolved?: boolean;
  /** Rang affiché dans le panneau, pour retrouver la note d'un coup d'œil. */
  index?: number;
  /** Teinte de l'auteur : on doit voir *de qui* est une note sans la lire. */
  color?: string;
};

/** Ce qu'un geste en cours est en train de faire. */
type Drag =
  | { kind: "scrub" }
  | { kind: "range"; anchor: number }
  | { kind: "edge"; edge: "start" | "end" };

type Props = {
  videoId: string;
  duration: number;
  currentTime: number;
  buffered: [number, number][];
  markers?: Marker[];
  /** Note sous la tête de lecture : son repère est mis en avant. */
  activeMarkerId?: string | null;
  onSeek: (time: number) => void;
  /**
   * Déplacement continu pendant un glissement. Distinct de `onSeek` : il
   * regroupe les demandes pour que l'image du grand lecteur suive réellement
   * le curseur — voir `scrubTo` dans le lecteur.
   */
  onScrub?: (time: number) => void;
  /** Plage en cours de composition dans le formulaire de note. */
  range?: Range | null;
  /** Le formulaire attend un glissement sur la piste. */
  rangeArmed?: boolean;
  onRangeChange?: (range: Range | null) => void;
  /** Un glissement vient d'aboutir : le formulaire peut se désarmer. */
  onRangeDone?: () => void;
};

export function Timeline({
  videoId,
  duration,
  currentTime,
  buffered,
  markers = [],
  activeMarkerId = null,
  onSeek,
  onScrub,
  range = null,
  rangeArmed = false,
  onRangeChange,
  onRangeDone,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  /**
   * Poignée pressée juste avant que l'événement n'atteigne la piste. La
   * poignée ne fait que poser ce drapeau, sans couper la propagation : c'est
   * la piste qui capture le pointeur, donc c'est elle qui recevra les
   * déplacements, y compris hors de son cadre.
   */
  const edgeRef = useRef<"start" | "end" | null>(null);
  /** Dernière position demandée pendant le geste, pour l'atterrissage. */
  const lastScrubRef = useRef<number | null>(null);

  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [everHovered, setEverHovered] = useState(false);

  const [trackWidth, setTrackWidth] = useState(0);

  const sprite = useSprite(videoId, everHovered);
  const rawScrub = onScrub ?? onSeek;

  /**
   * Toute position demandée pendant un geste passe par ici, pour qu'on sache
   * où atterrir au relâchement.
   */
  const scrub = (time: number) => {
    lastScrubRef.current = time;
    rawScrub(time);
  };

  // La largeur en pixels sert à savoir quand deux repères se toucheraient
  // vraiment à l'écran : en pourcentage seul, l'information manque.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => setTrackWidth(track.clientWidth));
    observer.observe(track);
    setTrackWidth(track.clientWidth);
    return () => observer.disconnect();
  }, []);

  const pct = (time: number) => (duration > 0 ? (time / duration) * 100 : 0);

  /**
   * Répartit les repères en rangées pour qu'aucun n'en cache un autre.
   * Une note ponctuelle posée à l'intérieur d'une plage se retrouvait
   * invisible sous la barre : on ne voyait qu'un seul problème là où il y
   * en avait deux. Chaque repère va dans la première rangée libre à sa
   * position, comme un planning.
   */
  const { placed, laneCount } = useMemo(() => {
    if (markers.length === 0 || duration <= 0)
      return { placed: [], laneCount: 1 };

    const minSpan = trackWidth > 0 ? (MARKER_FOOTPRINT / trackWidth) * 100 : 1.5;

    const items = markers
      .map((marker) => {
        const start = (marker.time / duration) * 100;
        const end = marker.end !== undefined ? (marker.end / duration) * 100 : start;
        return {
          marker,
          from: start - minSpan / 2,
          to: Math.max(end, start) + minSpan / 2,
        };
      })
      .sort((a, b) => a.from - b.from);

    const laneEnds: number[] = [];
    const placed = items.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.from);
      if (lane === -1) {
        // Toutes les rangées sont occupées : on ouvre la suivante, ou on
        // empile dans la dernière si le plafond est atteint.
        lane = laneEnds.length < MAX_LANES ? laneEnds.length : MAX_LANES - 1;
      }
      laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, item.to);
      return { ...item, lane };
    });

    return { placed, laneCount: Math.max(1, laneEnds.length) };
  }, [markers, duration, trackWidth]);

  /** Les bornes des notes : ce sont elles qu'on cherche à atteindre. */
  const snapTimes = useMemo(() => {
    const times = new Set<number>();
    for (const marker of markers) {
      times.add(marker.time);
      if (marker.end !== undefined) times.add(marker.end);
    }
    return [...times];
  }, [markers]);

  const timeFromEvent = useCallback(
    (clientX: number, snap = true) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const raw = Math.min(duration, Math.max(0, ratio * duration));
      if (!snap || rect.width === 0 || snapTimes.length === 0) return raw;

      // Le rayon est en pixels, donc converti en secondes selon la largeur
      // réelle : sur une fenêtre étroite, sept pixels valent plus de temps.
      let best = raw;
      let bestDistance = (SNAP_RADIUS / rect.width) * duration;
      for (const time of snapTimes) {
        const distance = Math.abs(time - raw);
        if (distance < bestDistance) {
          best = time;
          bestDistance = distance;
        }
      }
      return best;
    },
    [duration, snapTimes],
  );

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    // On capture le pointeur : le glissement continue même si le curseur
    // sort de la piste, comme dans un vrai lecteur.
    capturePointer(event.currentTarget, event.pointerId);
    const time = timeFromEvent(event.clientX, !event.altKey);

    // L'aperçu doit être là dès l'appui : sans ça, on cliquait à l'aveugle
    // et il n'apparaissait qu'au premier pixel de glissement.
    setHover(time);
    setEverHovered(true);
    setDragging(true);

    // Une poignée de plage a été pressée : on ajuste ce bord-là.
    const edge = edgeRef.current;
    edgeRef.current = null;
    if (edge && range) {
      dragRef.current = { kind: "edge", edge };
      scrub(edge === "start" ? range.start : range.end);
      return;
    }

    if (rangeArmed && onRangeChange) {
      dragRef.current = { kind: "range", anchor: time };
      onRangeChange({ start: time, end: time });
      scrub(time);
      return;
    }

    dragRef.current = { kind: "scrub" };
    scrub(time);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const time = timeFromEvent(event.clientX, !event.altKey);
    setHover(time);
    if (!everHovered) setEverHovered(true);

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === "range" && onRangeChange) {
      // On part d'un point d'ancrage : tirer vers la gauche construit la
      // plage dans l'autre sens sans qu'on ait à y penser.
      onRangeChange({
        start: Math.min(drag.anchor, time),
        end: Math.max(drag.anchor, time),
      });
      scrub(time);
      return;
    }

    if (drag.kind === "edge" && onRangeChange && range) {
      const other = drag.edge === "start" ? range.end : range.start;
      onRangeChange({ start: Math.min(other, time), end: Math.max(other, time) });
      // On suit le bord qu'on déplace, pas l'autre : c'est l'image de ce
      // bord-là qu'on est en train de choisir.
      scrub(time);
      return;
    }

    scrub(time);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    releasePointer(event.currentTarget, event.pointerId);
    const drag = dragRef.current;
    dragRef.current = null;
    edgeRef.current = null;
    setDragging(false);

    if (drag?.kind === "range" && onRangeChange) {
      if (!range || range.end - range.start < MIN_RANGE) {
        // Simple clic : on n'a pas voulu d'intervalle. On efface la plage
        // naissante mais on reste armé, sinon un clic manqué obligerait à
        // rouvrir le mode pour réessayer.
        onRangeChange(null);
      } else {
        onRangeDone?.();
      }
    }
    if (drag?.kind === "edge") onRangeDone?.();

    // Le déplacement groupé peut avoir laissé une demande en attente si le
    // décodeur n'avait plus de recherche à terminer. On atterrit franchement
    // sur la dernière position visée : sans ça, l'image affichée pourrait
    // rester une image en arrière de ce qu'on a choisi.
    const landing = lastScrubRef.current;
    lastScrubRef.current = null;
    if (drag && landing !== null) onSeek(landing);

    // Relâché hors de la piste, aucun `pointerleave` ne suivra — le
    // pointeur était capturé. Sans ça l'aperçu restait collé à l'écran.
    const rect = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) setHover(null);
  }

  // La piste s'épaissit au survol **et** pendant le glissement : en
  // `hover:` seul, elle redevenait un filet de 4 px dès que le curseur
  // sortait de la barre, alors qu'on était toujours en train de scruber.
  const active = dragging || hover !== null;
  const showRange = range !== null && duration > 0;

  return (
    <div data-tour="timeline" className="relative pt-4">
      {/* Bandeau d'aide, présent seulement pendant le choix d'une plage. Il
          occupe la place déjà réservée au-dessus de la piste, donc rien ne
          se déplace quand il apparaît. */}
      {rangeArmed && (
        <span className="label pointer-events-none absolute left-0 top-0 !text-accent">
          {range ? "Ajuste les poignées" : "Glisse sur la piste"}
        </span>
      )}

      {/* Zone de préhension. La barre visible fait 4 px : à la souris on ne
          vise pas 4 px, au doigt c'est hors de question. La zone fait 24 px
          de haut, centrée sur la barre, et ses marges négatives annulent son
          encombrement — rien ne bouge dans la mise en page. `touch-none`
          empêche le glissement tactile de faire défiler la page au lieu de
          déplacer la tête de lecture. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Position dans la vidéo"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={formatClock(currentTime)}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          if (!dragging) setHover(null);
        }}
        className={`group relative -my-2.5 flex h-6 touch-none select-none items-center ${
          rangeArmed ? "cursor-crosshair" : "cursor-pointer"
        }`}
      >
        <div
          ref={trackRef}
          className={`relative w-full bg-surface-3 transition-[height] ${
            active || rangeArmed ? "h-2" : "h-1"
          }`}
        >
          {/* Portions déjà téléchargées : montre ce qui est prêt à jouer. */}
          {buffered.map(([start, end], i) => (
            <div
              key={i}
              className="absolute inset-y-0 bg-line-strong"
              style={{ left: `${pct(start)}%`, width: `${pct(end - start)}%` }}
            />
          ))}

          {/* La portion lue s'allume : c'est l'objet le plus long de
              l'écran à porter l'accent, donc celui où le néon se voit sans
              qu'on ait à le poser partout ailleurs. */}
          <div
            className="neon-soft absolute inset-y-0 left-0 bg-accent"
            style={{ width: `${pct(currentTime)}%` }}
          />

          {/* Plage en cours de composition. Elle déborde la piste en hauteur
              pour rester lisible par-dessus la portion déjà lue, qui est de
              la même famille de teinte. */}
          {showRange && (
            <div
              className="neon-soft pointer-events-none absolute -bottom-1 -top-1 border-x-2 border-accent bg-accent/25"
              style={{
                left: `${pct(range.start)}%`,
                width: `${Math.max(pct(range.end - range.start), 0.2)}%`,
              }}
            />
          )}
        </div>

        {/* Poignées des bords, posées sur la zone de préhension pour ne pas
            être rognées par la piste. Elles ne coupent pas la propagation :
            elles marquent le bord visé, et c'est la piste qui capture. */}
        {showRange &&
          (["start", "end"] as const).map((edge) => (
            <button
              key={edge}
              type="button"
              tabIndex={-1}
              onPointerDown={() => {
                edgeRef.current = edge;
              }}
              aria-label={edge === "start" ? "Début de la plage" : "Fin de la plage"}
              title={`${edge === "start" ? "Début" : "Fin"} — ${formatClock(
                edge === "start" ? range.start : range.end,
              )}`}
              className="absolute top-1/2 h-5 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize"
              style={{ left: `${pct(edge === "start" ? range.start : range.end)}%` }}
            >
              <span
                aria-hidden
                className="absolute left-1/2 top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
              />
            </button>
          ))}

        {/* Tête de lecture : un trait fin, pas une pastille — on veut voir
            l'image précise sur laquelle on est. Elle s'allonge quand la
            piste est active, ce qui la rend attrapable sans la grossir :
            une pastille masquerait justement la position qu'elle indique. */}
        <div
          className={`pointer-events-none absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-fg shadow-[0_0_7px_rgba(232,236,243,0.5)] transition-[height] ${
            active ? "h-5" : "h-2.5"
          }`}
          style={{ left: `${pct(currentTime)}%` }}
        />

        {hover !== null && !dragging && (
          <div
            className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-fg/40"
            style={{ left: `${pct(hover)}%` }}
          />
        )}
      </div>

      {/* Repères de notes SOUS la piste : sur la barre, ils se perdaient
          dans la portion déjà lue. Un clic ramène à la note. */}
      <div
        className="pointer-events-none relative"
        style={{ height: laneCount * LANE_HEIGHT + 6 }}
      >
        {/* Les plages d'abord, les points ensuite : à rangée égale, un
            point reste visible par-dessus une barre. */}
        {placed
          .filter((item) => item.marker.end !== undefined)
          .map(({ marker, lane }) => {
            // La teinte dit *qui*, jamais *où en est* la note : une note
            // résolue garde la couleur de son auteur et recule en opacité.
            // Colorer le résolu en vert ferait deux messages dans un objet
            // de sept pixels, et on ne lirait plus ni l'un ni l'autre.
            const teinte = marker.color ?? "var(--color-accent)";
            return (
              <button
                key={marker.id}
                type="button"
                onClick={() => onSeek(marker.time)}
                title={marker.label}
                aria-label={`Aller à la note ${marker.index ?? ""} — de ${formatClock(marker.time)} à ${formatClock(marker.end!)}`}
                className={`pointer-events-auto absolute min-w-[5px] transition-all hover:!opacity-100 ${
                  marker.id === activeMarkerId ? "-mt-px h-[9px]" : "h-[7px]"
                }`}
                style={{
                  top: lane * LANE_HEIGHT + 1,
                  left: `${pct(marker.time)}%`,
                  width: `${Math.max(pct(marker.end! - marker.time), 0.4)}%`,
                  opacity: marker.resolved ? 0.4 : 1,
                }}
              >
                {/* Zone de clic élargie, invisible : le repère ne fait que
                    quelques pixels, on ne vise pas ça à la souris. Elle
                    déborde surtout horizontalement — verticalement les
                    rangées ne sont espacées que de 8 px. */}
                <span aria-hidden className="absolute -inset-x-1 -inset-y-1" />
                {/* Crochet entrée/sortie : montants pleins aux deux bouts,
                    trait mince entre les deux. La forme suffit à distinguer
                    une plage d'une note ponctuelle. */}
                <span
                  aria-hidden
                  className={`absolute inset-x-0 top-[3px] h-[1.5px] rounded-full ${
                    marker.id === activeMarkerId ? "opacity-100" : "opacity-60"
                  }`}
                  style={{ background: teinte }}
                />
                <span
                  aria-hidden
                  className="absolute left-0 top-0 h-full w-[2px] rounded-[1px]"
                  style={{ background: teinte }}
                />
                <span
                  aria-hidden
                  className="absolute right-0 top-0 h-full w-[2px] rounded-[1px]"
                  style={{ background: teinte }}
                />
              </button>
            );
          })}

        {placed
          .filter((item) => item.marker.end === undefined)
          .map(({ marker, lane }) => (
            <button
              key={marker.id}
              type="button"
              onClick={() => onSeek(marker.time)}
              title={marker.label}
              aria-label={`Aller à la note ${marker.index ?? ""} — ${formatClock(marker.time)}`}
              className="pointer-events-auto absolute -translate-x-1/2 leading-none hover:!opacity-100"
              style={{
                top: lane * LANE_HEIGHT + 1,
                left: `${pct(marker.time)}%`,
                opacity: marker.resolved ? 0.4 : 1,
              }}
            >
              {/* Voir plus haut : le triangle fait 8 × 7 px, la cible réelle
                  doit être plus large que le dessin. */}
              <span aria-hidden className="absolute -inset-x-2.5 -inset-y-1" />
              <span
                className={`block size-0 border-x-[4.5px] border-b-[7px] border-x-transparent drop-shadow-[0_0_1.5px_rgba(0,0,0,0.9)] transition-transform hover:scale-125 ${
                  marker.id === activeMarkerId ? "scale-125" : ""
                }`}
                style={{ borderBottomColor: marker.color ?? "var(--color-accent)" }}
              />
            </button>
          ))}
      </div>

      {hover !== null && (
        <Preview
          videoId={videoId}
          time={hover}
          ratio={pct(hover)}
          duration={duration}
          sprite={sprite}
        />
      )}
    </div>
  );
}

function Preview({
  videoId,
  time,
  ratio,
  duration,
  sprite,
}: {
  videoId: string;
  time: number;
  ratio: number;
  duration: number;
  sprite: { w: number; h: number } | null;
}) {
  const tileHeight = sprite
    ? Math.round((PREVIEW_WIDTH * (sprite.h / SPRITE_ROWS)) / (sprite.w / SPRITE_COLS))
    : 0;

  const index = Math.min(
    SPRITE_COLS * SPRITE_ROWS - 1,
    Math.max(0, Math.floor((time / duration) * SPRITE_COLS * SPRITE_ROWS)),
  );
  const col = index % SPRITE_COLS;
  const row = Math.floor(index / SPRITE_COLS);

  return (
    <div
      className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2"
      // Le cartouche reste dans la piste même aux extrémités : sinon il
      // sortirait du lecteur au début et à la fin.
      style={{ left: `clamp(${PREVIEW_WIDTH / 2}px, ${ratio}%, calc(100% - ${PREVIEW_WIDTH / 2}px))` }}
    >
      {sprite && (
        <div
          className="rounded-sm border border-line-strong bg-black"
          style={{
            width: PREVIEW_WIDTH,
            height: tileHeight,
            backgroundImage: `url(/api/videos/${videoId}/sprite)`,
            backgroundSize: `${SPRITE_COLS * 100}% ${SPRITE_ROWS * 100}%`,
            backgroundPosition: `${(col / (SPRITE_COLS - 1)) * 100}% ${(row / (SPRITE_ROWS - 1)) * 100}%`,
          }}
        />
      )}
      <span className="mt-0.5 block rounded-sm border border-line bg-bg px-1.5 py-0.5 text-center font-mono text-[10px] tabular-nums text-fg">
        {formatClock(time)}
      </span>
    </div>
  );
}
