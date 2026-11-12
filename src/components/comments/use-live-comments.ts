"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLivePoll } from "../use-live-poll";
import { useLiveEvents } from "../use-live-events";
import type { CommentWithAuthor } from "@/lib/comments";

/**
 * Cadence de fond, à la demande de Toma. Ce qui compte à trois utilisateurs,
 * c'est le rattrapage au retour au premier plan, pas le minuteur.
 */
const POLL_MS = 5 * 60 * 1000;
/**
 * Plancher anti-rafale. C'est lui qui borne le pire cas, pas `POLL_MS` -
 * l'ordonnanceur explique pourquoi, mesures comprises.
 */
const MIN_GAP_MS = 30_000;

/**
 * Garde la liste des notes à jour sans recharger la page.
 *
 * La politique de déclenchement, visibilité, rattrapage au premier plan,
 * plancher, arrêt propre, vit dans `useLivePoll`, partagée avec la grille
 * des projets. Ici il ne reste que le **transport**, propre à cette page :
 * on ne rapporte que du JSON et on ne re-rend jamais la route, parce qu'un
 * lecteur vidéo joue derrière.
 *
 * Deux précautions qui appartiennent bien au transport :
 *
 * - **Rien de neuf, aucun rendu.** On compare l'empreinte du jeu reçu à
 *   celle du jeu appliqué. La grande majorité des tours passent par là.
 * - **La priorité au serveur.** Une mutation locale passe par
 *   `revalidatePath` et renvoie une liste plus fraîche que n'importe quel
 *   sondage : elle écrase l'état local, ce qui garde l'écriture d'une note
 *   instantanée.
 */
/** Quelqu'un qui a la vidéo ouverte en ce moment. */
export type Viewer = { id: string; name: string; color: number };

export function useLiveComments(
  videoId: string,
  fromServer: CommentWithAuthor[],
) {
  const [live, setLive] = useState(fromServer);
  const applied = useRef(JSON.stringify(fromServer));
  const inFlight = useRef<AbortController | null>(null);

  // Une mutation locale passe par `revalidatePath` : le serveur renvoie une
  // liste plus fraîche que n'importe quel sondage, elle a donc la priorité.
  // C'est aussi ce qui garde l'écriture d'une note instantanée.
  useEffect(() => {
    applied.current = JSON.stringify(fromServer);
    setLive(fromServer);
  }, [fromServer]);

  const tick = useCallback(async () => {
    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;

    const response = await fetch(`/api/videos/${videoId}/comments`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return;

    const fresh = (await response.json()) as CommentWithAuthor[];
    const signature = JSON.stringify(fresh);
    // Rien de neuf : on ne rend pas. La grande majorité des tours passent
    // par ici et coûtent alors exactement zéro rendu.
    if (signature === applied.current) return;
    applied.current = signature;
    setLive(fresh);
  }, [videoId]);

  useLivePoll(tick, { pollMs: POLL_MS, minGapMs: MIN_GAP_MS });

  // Le direct. Le serveur dit seulement « les notes ont changé », on relit
  // par la route habituelle, qui vérifie les droits. Le sondage ci-dessus
  // reste le filet : derrière un proxy qui retient les flux, il fait encore
  // le travail au retour au premier plan.
  const [viewers, setViewers] = useState<Viewer[]>([]);
  useLiveEvents(`/api/events?video=${videoId}`, {
    comments: () => void tick().catch(() => {}),
    presence: (data) => setViewers(Array.isArray(data) ? (data as Viewer[]) : []),
  });

  // La requête en vol est abandonnée au démontage : sans ça, quitter la page
  // laisserait une réponse arriver dans un composant démonté.
  useEffect(() => () => inFlight.current?.abort(), []);

  return { comments: live, viewers };
}
