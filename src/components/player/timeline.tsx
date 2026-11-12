"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@/lib/timecode";
import { capturePointer, releasePointer } from "@/lib/pointer";

/** Doit correspondre à la grille produite par `makeSprite`. */
const SPRITE_COLS = 10;
const SPRITE_ROWS = 10;
const PREVIEW_WIDTH = 150;

/** Hauteur de la bande d'images, en pixels. */
const STRIP_HEIGHT = 44;
/** Écart minimal entre deux graduations chiffrées de la règle. */
const TICK_SPACING = 84;
/** Pas « ronds » d'une règle de temps, en secondes. */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Hauteur d'une rangée de repères, marge comprise. */
const LANE_HEIGHT = 22;
/** Au-delà, on empilerait plus haut que le lecteur ne le supporte. */
const MAX_LANES = 3;
/** Encombrement minimal d'un repère ponctuel, en pixels. */
const MARKER_FOOTPRINT = 22;
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

type Sprite = { url: string; w: number; h: number };
const SPRITE_ATTEMPTS = 5;
const SPRITE_RETRY_MS = 20_000;

/**
 * Charge la planche d'aperçu et renvoie ses dimensions natives, dont on
 * déduit le rapport d'une vignette.
 *
 * Elle n'était chargée qu'au premier survol, pour économiser 180 Ko. Elle
 * est maintenant le matériau de la piste elle-même, la bande d'images, donc
 * demandée dès l'ouverture : c'est ce qu'on vient regarder sur cette page.
 */
function useSprite(videoId: string, wanted: boolean) {
  const [sprite, setSprite] = useState<Sprite | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!wanted || sprite || attempt >= SPRITE_ATTEMPTS) return;
    let timer = 0;
    const img = new Image();
    // Le numéro d'essai dans l'adresse : sans lui le navigateur resservirait
    // son échec précédent.
    const url = `/api/videos/${videoId}/sprite${attempt > 0 ? `?essai=${attempt}` : ""}`;
    img.src = url;
    img.onload = () => setSprite({ url, w: img.naturalWidth, h: img.naturalHeight });
    // La planche se fabrique après l'envoi et peut ne pas être prête : on
    // repasse quelques fois, puis on n'insiste plus, une vidéo ancienne
    // n'en aura jamais.
    img.onerror = () => {
      timer = window.setTimeout(() => setAttempt((n) => n + 1), SPRITE_RETRY_MS);
    };
    return () => {
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
  }, [videoId, wanted, sprite, attempt]);

  return sprite;
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
   * le curseur, voir `scrubTo` dans le lecteur.
   */
  onScrub?: (time: number) => void;
  /** Plage en cours de composition dans le formulaire de note. */
  range?: Range | null;
  /** Le formulaire attend un glissement sur la piste. */
  rangeArmed?: boolean;
  onRangeChange?: (range: Range | null) => void;
  /** Un glissement vient d'aboutir : le formulaire peut se désarmer. */
  onRangeDone?: () => void;
  /** Clic sur le repère d'une note. Par défaut, un simple déplacement. */
  onMarkerSeek?: (time: number) => void;
  /** Points d'entrée et de sortie de la boucle, posés avec I et O. */
  loop?: { in: number | null; out: number | null };
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
  onMarkerSeek,
  loop,
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

  const sprite = useSprite(videoId, true);
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

    // Relâché hors de la piste, aucun `pointerleave` ne suivra, le
    // pointeur était capturé. Sans ça l'aperçu restait collé à l'écran.
    const rect = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) setHover(null);
  }

  /**
   * La bande d'images : la piste est faite du film lui-même.
   *
   * Un filet de 4 px disait où on en était, pas ce qu'il y avait à cet
   * endroit. On cherchait un plan en balayant la barre et en lisant l'aperçu.
   * Avec les images posées bout à bout, comme sur une timeline de montage, on
   * voit le changement de plan avant d'y aller.
   *
   * Autant de vignettes que la largeur en contient, chacune prise au milieu
   * de l'intervalle qu'elle couvre. Sans planche (vidéo ancienne, conversion
   * en cours) on retombe sur le filet d'avant.
   */
  const tiles = useMemo(() => {
    if (!sprite || trackWidth <= 0 || duration <= 0) return null;
    const tileWidth = STRIP_HEIGHT * ((sprite.w / SPRITE_COLS) / (sprite.h / SPRITE_ROWS));
    const count = Math.max(1, Math.round(trackWidth / tileWidth));
    return Array.from({ length: count }, (_, i) => {
      const index = Math.min(
        SPRITE_COLS * SPRITE_ROWS - 1,
        Math.floor(((i + 0.5) / count) * SPRITE_COLS * SPRITE_ROWS),
      );
      return {
        x: ((index % SPRITE_COLS) / (SPRITE_COLS - 1)) * 100,
        y: (Math.floor(index / SPRITE_COLS) / (SPRITE_ROWS - 1)) * 100,
      };
    });
  }, [sprite, trackWidth, duration]);
  const strip = tiles !== null;

  /** Graduations de la règle : le premier pas rond qui laisse la place de lire. */
  const ticks = useMemo(() => {
    if (!strip || duration <= 0) return [];
    const perPixel = duration / trackWidth;
    const step = TICK_STEPS.find((s) => s / perPixel >= TICK_SPACING) ?? 3600;
    const list: number[] = [];
    // On s'arrête avant la fin : la dernière étiquette déborderait du lecteur.
    for (let time = 0; time < duration - step * 0.35; time += step) list.push(time);
    return list;
  }, [strip, duration, trackWidth]);

  // La piste s'épaissit au survol **et** pendant le glissement : en
  // `hover:` seul, elle redevenait un filet de 4 px dès que le curseur
  // sortait de la barre, alors qu'on était toujours en train de scruber.
  const active = dragging || hover !== null;
  const showRange = range !== null && duration > 0;

  return (
    <div data-tour="timeline" className={`relative ${strip ? "pt-5" : "pt-4"}`}>
      {/* Règle de temps. Elle cède la place à la consigne pendant le choix
          d'une plage, les deux occupent la même marge. */}
      {strip && !rangeArmed && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-5">
          {ticks.map((time) => (
            <span
              key={time}
              className="absolute bottom-0 flex h-full items-end border-l border-line-strong pl-1 font-mono text-[10.5px] leading-none tabular-nums text-muted"
              style={{ left: `${pct(time)}%` }}
            >
              <span className="pb-1">{formatClock(time)}</span>
            </span>
          ))}
        </div>
      )}
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
          encombrement, rien ne bouge dans la mise en page. `touch-none`
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
        className={`group relative flex touch-none select-none items-center ${
          strip ? "" : "-my-2.5 h-6"
        } ${rangeArmed ? "cursor-crosshair" : "cursor-pointer"}`}
        style={strip ? { height: STRIP_HEIGHT } : undefined}
      >
        <div
          ref={trackRef}
          className={
            strip
              ? "relative h-full w-full overflow-hidden rounded-sm bg-black ring-1 ring-line"
              : `relative w-full bg-surface-3 transition-[height] ${
                  active || rangeArmed ? "h-2" : "h-1"
                }`
          }
        >
          {tiles && sprite && (
            <div aria-hidden className="absolute inset-0 flex">
              {tiles.map((tile, i) => (
                <span
                  key={i}
                  className="h-full flex-1 border-r border-black/60 last:border-r-0"
                  style={{
                    backgroundImage: `url(${sprite.url})`,
                    backgroundSize: `${SPRITE_COLS * 100}% ${SPRITE_ROWS * 100}%`,
                    backgroundPosition: `${tile.x}% ${tile.y}%`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Ce qui reste à voir recule dans l'ombre : la partie lue se lit
              d'un coup d'œil sans poser un aplat de couleur sur les images. */}
          {strip && (
            <div
              aria-hidden
              className="absolute inset-y-0 right-0 bg-bg/60"
              style={{ left: `${pct(currentTime)}%` }}
            />
          )}

          {/* Chaque note marque la bande, à la couleur de son auteur : un
              trait à son image, et pour une plage un bandeau sur sa durée.
              Sous la piste on lit *quelle* note ; ici on voit d'abord *où*
              il y a quelque chose à reprendre, sans quitter l'image des
              yeux. Une note résolue s'efface presque. */}
          {markers.map((marker) => {
            const teinte = marker.color ?? "var(--color-accent)";
            return (
              <div
                key={`trait-${marker.id}`}
                aria-hidden
                className="pointer-events-none absolute inset-y-0"
                style={{
                  left: `${pct(marker.time)}%`,
                  width:
                    marker.end !== undefined ? `${pct(marker.end - marker.time)}%` : undefined,
                  opacity: marker.resolved ? 0.3 : 1,
                }}
              >
                {marker.end !== undefined && (
                  <span
                    className="absolute inset-0"
                    style={{ background: `color-mix(in srgb, ${teinte} 26%, transparent)` }}
                  />
                )}
                <span
                  className="absolute inset-y-0 left-0 w-[3px] -translate-x-1/2 shadow-[0_0_0_1px_rgba(0,0,0,0.75)]"
                  style={{ background: teinte }}
                />
                {marker.end !== undefined && (
                  <span
                    className="absolute inset-y-0 right-0 w-[3px] translate-x-1/2 shadow-[0_0_0_1px_rgba(0,0,0,0.75)]"
                    style={{ background: teinte }}
                  />
                )}
              </div>
            );
          })}

          {/* Portions déjà téléchargées : montre ce qui est prêt à jouer. */}
          {buffered.map(([start, end], i) => (
            <div
              key={i}
              className={`absolute bg-line-strong ${strip ? "bottom-0 h-0.5 opacity-80" : "inset-y-0"}`}
              style={{ left: `${pct(start)}%`, width: `${pct(end - start)}%` }}
            />
          ))}

          {/* La portion lue s'allume : c'est l'objet le plus long de
              l'écran à porter l'accent, donc celui où le néon se voit sans
              qu'on ait à le poser partout ailleurs. */}
          <div
            className={`neon-soft absolute left-0 bg-accent ${strip ? "bottom-0 h-0.5" : "inset-y-0"}`}
            style={{ width: `${pct(currentTime)}%` }}
          />

          {/* Boucle : un liseré clair en tête de piste entre l'entrée et la
              sortie, deux butées aux extrémités. Clair et non à l'accent :
              l'accent est pris par la lecture et par la plage d'une note. */}
          {loop && loop.in !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 border-l-2 border-fg"
              style={{ left: `${pct(loop.in)}%` }}
            />
          )}
          {loop && loop.out !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 border-r-2 border-fg"
              style={{ left: 0, width: `${pct(loop.out)}%` }}
            />
          )}
          {loop && loop.in !== null && loop.out !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 h-[3px] bg-fg"
              style={{ left: `${pct(loop.in)}%`, width: `${pct(loop.out - loop.in)}%` }}
            />
          )}

          {/* Plage en cours de composition. Elle déborde la piste en hauteur
              pour rester lisible par-dessus la portion déjà lue, qui est de
              la même famille de teinte. */}
          {showRange && (
            <div
              className={`neon-soft pointer-events-none absolute border-x-2 border-accent bg-accent/25 ${
                strip ? "inset-y-0" : "-bottom-1 -top-1"
              }`}
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
              title={`${edge === "start" ? "Début" : "Fin"} : ${formatClock(
                edge === "start" ? range.start : range.end,
              )}`}
              className={`absolute top-1/2 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize ${
                strip ? "h-full" : "h-5"
              }`}
              style={{ left: `${pct(edge === "start" ? range.start : range.end)}%` }}
            >
              <span
                aria-hidden
                className={`absolute left-1/2 top-1/2 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_1px_rgba(0,0,0,0.6)] ${
                  strip ? "h-full" : "h-4"
                }`}
              />
            </button>
          ))}

        {/* Tête de lecture : un trait fin, pas une pastille, on veut voir
            l'image précise sur laquelle on est. Elle s'allonge quand la
            piste est active, ce qui la rend attrapable sans la grossir :
            une pastille masquerait justement la position qu'elle indique. */}
        <div
          className={
            strip
              ? "neon pointer-events-none absolute -bottom-1 -top-1.5 w-0.5 -translate-x-1/2 bg-accent"
              : `pointer-events-none absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-fg shadow-[0_0_7px_rgba(232,236,243,0.5)] transition-[height] ${
                  active ? "h-5" : "h-2.5"
                }`
          }
          style={{ left: `${pct(currentTime)}%` }}
        >
          {/* Sur la bande, la tête porte un onglet : c'est lui qu'on repère
              parmi les images, un trait seul s'y perdait. */}
          {strip && (
            <span
              aria-hidden
              className="absolute left-1/2 top-0 size-0 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-accent"
            />
          )}
        </div>

        {hover !== null && !dragging && (
          <div
            className={`pointer-events-none absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2 ${
              strip ? "h-full bg-fg/70" : "h-2.5 bg-fg/40"
            }`}
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
        {/* Une pastille par note, à son numéro et à la couleur de son
            auteur. C'étaient des triangles de 8 px : on ne voyait ni où
            étaient les notes, ni laquelle était laquelle, alors que c'est
            la liste de ce qu'il reste à faire. Le numéro est celui du
            panneau, on passe de l'un à l'autre sans chercher. */}
        {placed.map(({ marker, lane }) => {
          const teinte = marker.color ?? "var(--color-accent)";
          const isActive = marker.id === activeMarkerId;
          const isRange = marker.end !== undefined;
          return (
            <button
              key={marker.id}
              type="button"
              onClick={() => (onMarkerSeek ?? onSeek)(marker.time)}
              title={marker.label}
              aria-label={
                isRange
                  ? `Aller à la note ${marker.index ?? ""}, de ${formatClock(marker.time)} à ${formatClock(marker.end!)}`
                  : `Aller à la note ${marker.index ?? ""}, ${formatClock(marker.time)}`
              }
              className={`pointer-events-auto absolute flex h-[18px] items-center rounded-full text-[11px] font-bold leading-none tabular-nums text-[#07090e] transition-transform hover:z-10 hover:scale-110 hover:!opacity-100 ${
                isRange ? "justify-start px-[5px]" : "w-[18px] -translate-x-1/2 justify-center"
              } ${isActive ? "z-10 scale-110 ring-2 ring-fg" : "ring-1 ring-black/70"}`}
              style={{
                top: lane * LANE_HEIGHT + 4,
                left: `${pct(marker.time)}%`,
                // Une plage s'étire sur sa durée, sans jamais devenir plus
                // étroite que la pastille d'une note ponctuelle.
                width: isRange
                  ? `max(18px, ${pct(marker.end! - marker.time)}%)`
                  : undefined,
                background: teinte,
                opacity: marker.resolved ? 0.4 : 1,
              }}
            >
              {marker.index}
            </button>
          );
        })}
      </div>

      {hover !== null && (
        <Preview
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
  time,
  ratio,
  duration,
  sprite,
}: {
  time: number;
  ratio: number;
  duration: number;
  sprite: Sprite | null;
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
            backgroundImage: `url(${sprite.url})`,
            backgroundSize: `${SPRITE_COLS * 100}% ${SPRITE_ROWS * 100}%`,
            backgroundPosition: `${(col / (SPRITE_COLS - 1)) * 100}% ${(row / (SPRITE_ROWS - 1)) * 100}%`,
          }}
        />
      )}
      <span className="mt-0.5 block rounded-sm border border-line bg-bg px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums text-fg">
        {formatClock(time)}
      </span>
    </div>
  );
}
