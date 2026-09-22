"use client";

import { useEffect, useRef, useState } from "react";

/** Ralenti demandé : 10 % sous la vitesse réelle. */
const RATE = 0.9;

/**
 * Virage au bleu de la prise. Voir le commentaire du composant.
 *
 * `brightness(1.05)` n'est pas un choix esthétique mais une compensation :
 * mesuré au canvas, `grayscale(0.92)` seul faisait tomber la part de l'image
 * réellement lisible de 65 % à 7 %, et sous le voile radial de la page la
 * bobine aurait disparu. À 1,05 on repasse à 80 %, teinte finale 215° -
 * celle de l'accent.
 */
const COOL =
  "grayscale(0.92) brightness(1.05) sepia(0.22) hue-rotate(168deg) saturate(2.6)";

/**
 * Fond animé de l'écran de connexion : la bobine qui tourne, en boucle et
 * ralentie.
 *
 * Composant client pour une seule raison : `playbackRate` n'existe pas en
 * attribut HTML, c'est une propriété qu'il faut poser sur l'élément après
 * son montage. Elle est aussi remise à chaque `loadedmetadata`, un
 * navigateur qui recharge la source (changement de réseau, reprise après
 * veille) repart à 1× sans prévenir.
 *
 * `muted` n'est pas un choix esthétique : sans lui aucun navigateur
 * n'autorise la lecture automatique. La piste audio a d'ailleurs été retirée
 * du fichier, 170 Ko qu'on ne pourra jamais entendre.
 *
 * La bobine a été filmée sous une lumière chaude, et l'interface ne l'est
 * plus. Plutôt que de refaire la prise, on la vire au bleu par un filtre :
 * on la désature presque entièrement, on lui rend une trace de teinte par
 * `sepia`, on fait tourner cette teinte jusqu'au bleu, puis on la renforce.
 * L'enchaînement compte, un `hue-rotate` sur une image déjà grise ne
 * tournerait rien du tout. On garde ainsi la matière de la prise, la
 * poussière et le mouvement, sans la dominante orange.
 *
 * Sous `prefers-reduced-motion`, on sert l'image fixe à la place : une
 * boucle vidéo derrière un formulaire est exactement ce que ce réglage
 * demande d'éviter. C'est aussi le repli quand la vidéo ne peut pas être
 * décodée, et l'affiche pendant son chargement, l'écran n'est jamais vide.
 */
export function LoginBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setStill(reduced.matches);
    apply();
    reduced.addEventListener("change", apply);
    return () => reduced.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || still) return;
    const setRate = () => {
      video.playbackRate = RATE;
    };
    setRate();
    video.addEventListener("loadedmetadata", setRate);
    return () => video.removeEventListener("loadedmetadata", setRate);
  }, [still]);

  if (still) {
    return (
      <div
        aria-hidden
        style={{ filter: COOL }}
        className="absolute inset-0 bg-[url('/bg/bobine.jpg')] bg-cover bg-center"
      />
    );
  }

  return (
    <video
      ref={videoRef}
      aria-hidden
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      poster="/bg/bobine.jpg"
      onError={() => setStill(true)}
      style={{ filter: COOL }}
      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
    >
      <source src="/bg/connexion.mp4" type="video/mp4" />
    </video>
  );
}
