"use client";

import { useCallback, useEffect, useState } from "react";

export type TourStep = {
  /** Valeur de l'attribut `data-tour` à mettre en avant. Absent : carte centrée. */
  target?: string;
  title: string;
  body: string;
  /** Geste ou raccourci à retenir, posé en pastille sous le texte. */
  hint?: string;
  /**
   * La cible ne se montre qu'au survol, les boutons d'action d'une
   * vignette. Le guide la force visible le temps de l'étape, sinon le halo
   * encadrerait du vide.
   */
  reveal?: boolean;
};

const STORE_PREFIX = "reviewer:tour:";
/** Marge du halo autour de la cible. */
const HALO_PAD = 8;
const CARD_WIDTH = 340;
/** Place qu'il faut sous la cible pour y poser la bulle plutôt qu'au-dessus. */
const CARD_ROOM = 240;
/**
 * Le temps que la grille se pose : elle arrive en cascade (`rise`), et une
 * mesure prise en pleine animation cadrerait à côté.
 */
const SETTLE_MS = 450;

type Box = { top: number; left: number; width: number; height: number };

/**
 * Où poser la bulle. Sous la cible s'il y a la place, au-dessus sinon, et
 * **à côté** quand la cible est trop haute pour laisser quoi que ce soit
 * dans l'axe vertical, le panneau de notes fait presque toute la hauteur
 * de la fenêtre, et sans ce troisième cas la bulle sortait par le haut.
 *
 * On se contente d'estimer la hauteur de la bulle : la mesurer imposerait
 * un rendu en deux passes pour un gain que l'œil ne verrait pas.
 */
function place(halo: Box | null): React.CSSProperties {
  const centered: React.CSSProperties = {
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
  };
  if (!halo) return centered;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Centrée sur la cible, mais jamais à cheval sur un bord.
  const centerX = Math.min(
    Math.max(halo.left + halo.width / 2, CARD_WIDTH / 2 + 16),
    vw - CARD_WIDTH / 2 - 16,
  );

  if (vh - (halo.top + halo.height) >= CARD_ROOM)
    return {
      top: halo.top + halo.height + 12,
      left: centerX,
      transform: "translateX(-50%)",
    };

  if (halo.top >= CARD_ROOM)
    return {
      bottom: vh - halo.top + 12,
      left: centerX,
      transform: "translateX(-50%)",
    };

  const roomRight = vw - (halo.left + halo.width);
  if (Math.max(halo.left, roomRight) >= CARD_WIDTH + 32) {
    const onLeft = halo.left > roomRight;
    return {
      top: "50%",
      left: onLeft ? halo.left - 16 : halo.left + halo.width + 16,
      transform: onLeft ? "translate(-100%, -50%)" : "translateY(-50%)",
    };
  }

  // Cible qui remplit l'écran dans les deux axes : la bulle se pose dessus,
  // au centre. C'est le dernier recours, pas le cas courant.
  return centered;
}

function findTarget(step: TourStep | undefined) {
  if (!step?.target) return null;
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

/**
 * Guide de première visite : un halo sur l'élément dont on parle, une bulle
 * à côté, et on avance. Deux tours existent, la page des projets et
 * l'espace de review, chacun lancé au premier passage sur sa page, ce qui
 * met l'explication au moment où elle sert plutôt que tout d'un bloc à la
 * connexion.
 */
export function Tour({ id, steps }: { id: string; steps: TourStep[] }) {
  /** Non nul = le guide tourne. Ne contient que les étapes montrables. */
  const [running, setRunning] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);

  const key = STORE_PREFIX + id;

  const start = useCallback(() => {
    // Une étape sans cible à l'écran serait un halo dans le vide : sur une
    // installation neuve il n'y a ni vidéo ni note à montrer, et le guide
    // doit rester juste dans ce cas-là aussi.
    const usable = steps.filter((step) => !step.target || findTarget(step));
    if (usable.length === 0) return;
    setRunning(usable);
    setIndex(0);
  }, [steps]);

  const stop = useCallback(() => {
    setRunning(null);
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Navigation privée ou stockage refusé : le guide se represente, ce
      // qui est moins gênant que de planter au premier écran.
    }
  }, [key]);

  /**
   * Premier passage **sur ce poste**. Le stockage local est exactement la
   * bonne portée : « déjà vu » vaut par navigateur et par machine, pas par
   * compte. C'est l'habitude du poste qu'on suit, et les trois comptes de
   * l'app partagent parfois la même machine.
   */
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(key) !== null;
    } catch {
      // Stockage inaccessible : on ne s'impose pas.
    }
    if (seen) return;
    const timer = window.setTimeout(start, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [key, start]);

  // Le bouton « Guide » de l'en-tête relance celui de la page courante.
  useEffect(() => {
    window.addEventListener("reviewer:tour", start);
    return () => window.removeEventListener("reviewer:tour", start);
  }, [start]);

  const step = running?.[index];

  useEffect(() => {
    if (!step) return;
    const element = findTarget(step);
    if (!element) {
      setBox(null);
      return;
    }
    // Amenée à l'écran sans animation : une mesure prise pendant un
    // défilement doux se tromperait de cent pixels.
    element.scrollIntoView({ block: "center", behavior: "auto" });

    let frame = 0;
    let previous = "";
    const follow = () => {
      // La cible peut disparaître sous le guide : quelqu'un d'autre supprime
      // la vidéo encadrée et la grille se met à jour. `getBoundingClientRect`
      // sur un nœud détaché ne lève pas d'erreur, il renvoie des zéros, le
      // halo s'effondrerait en petit carré dans le coin haut-gauche. On lâche
      // la cible et la bulle se recentre, ce qui se lit comme une étape sans
      // cible plutôt que comme un défaut d'affichage.
      if (!element.isConnected) {
        setBox(null);
        return;
      }

      const rect = element.getBoundingClientRect();
      const signature = `${rect.top}|${rect.left}|${rect.width}|${rect.height}`;
      // Le halo colle à la cible image par image, panneau qui défile,
      // fenêtre qu'on redimensionne, piste qui s'épaissit, mais on ne
      // rend que quand elle a vraiment bougé.
      if (signature !== previous) {
        previous = signature;
        setBox({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    const root = document.documentElement;
    if (step?.reveal && step.target) root.dataset.tourReveal = step.target;
    else delete root.dataset.tourReveal;
    return () => {
      delete root.dataset.tourReveal;
    };
  }, [step]);

  /**
   * Le guide publie qu'il est à l'écran, sur le même chemin que
   * `tourReveal`. Le sondage de la grille le lit pour reporter son tour :
   * faire bouger la cible sous le halo pendant une explication n'apporte
   * rien. Publié plutôt que deviné, un sélecteur du genre
   * `[role="dialog"]` marcherait aujourd'hui et casserait au premier autre
   * dialogue de l'app, sans rien pour le signaler.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (running) root.dataset.tourRunning = "1";
    else delete root.dataset.tourRunning;
    return () => {
      delete root.dataset.tourRunning;
    };
  }, [running]);

  const next = useCallback(() => {
    if (!running) return;
    if (index + 1 >= running.length) stop();
    else setIndex(index + 1);
  }, [running, index, stop]);

  const previous = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => {
    if (!running) return;
    function onKey(event: KeyboardEvent) {
      if (
        event.key !== "Escape" &&
        event.key !== "Enter" &&
        event.key !== "ArrowRight" &&
        event.key !== "ArrowLeft"
      )
        return;
      // Capture, puis arrêt de la propagation : le lecteur écoute les mêmes
      // flèches sur `window`. Sans ça, avancer d'une étape déplacerait la
      // vidéo d'une image en même temps.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") stop();
      else if (event.key === "ArrowLeft") previous();
      else next();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [running, next, previous, stop]);

  if (!running || !step) return null;

  const last = index === running.length - 1;

  const halo = box
    ? {
        top: box.top - HALO_PAD,
        left: box.left - HALO_PAD,
        width: box.width + HALO_PAD * 2,
        height: box.height + HALO_PAD * 2,
      }
    : null;

  const cardStyle = place(halo);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Guide, ${step.title}`}
      className="fixed inset-0 z-50"
    >
      {/* Absorbe les clics : on ne part pas ailleurs au milieu d'une
          explication, et on ne déclenche pas par erreur l'élément encadré. */}
      <div className="absolute inset-0" />

      {halo ? (
        /* Le voile n'est pas un calque mais l'ombre portée démesurée du
           halo : c'est ce qui permet d'avoir un trou net, impossible avec
           un rectangle posé par-dessus. */
        <span aria-hidden className="tour-halo absolute rounded-md" style={halo} />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-bg/75" />
      )}

      <div
        style={cardStyle}
        className="absolute w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-accent-dim bg-surface p-4 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="label !text-accent">
            Guide {index + 1}/{running.length}
          </span>
          <button
            type="button"
            onClick={stop}
            className="label -my-1 py-1 transition-colors hover:!text-fg"
          >
            passer
          </button>
        </div>

        <h2 className="heading heading-sm mt-2 text-[15px]">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-dim">{step.body}</p>

        {step.hint && (
          <p className="mt-2.5">
            <span className="rounded-sm border border-line bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-dim">
              {step.hint}
            </span>
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          {/* Points d'avancement : on décide de suivre ou de passer selon
              ce qu'il reste, pas à l'aveugle. */}
          <span aria-hidden className="flex gap-1">
            {running.map((_, i) => (
              <span
                key={i}
                className={`size-1.5 rounded-full transition-colors ${
                  i === index ? "bg-accent" : "bg-line-strong"
                }`}
              />
            ))}
          </span>

          <span className="ml-auto flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={previous}
                className="btn btn-ghost !py-1"
              >
                Retour
              </button>
            )}
            <button
              type="button"
              onClick={next}
              autoFocus
              className="btn btn-primary !py-1"
            >
              {last ? "C'est parti" : "Suivant"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
