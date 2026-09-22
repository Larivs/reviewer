"use client";

import { useEffect, useRef } from "react";

type Options = {
  /** Cadence de fond, en millisecondes. */
  pollMs: number;
  /**
   * Délai minimal entre deux tours, quelle que soit la raison. **C'est lui
   * qui borne le pire cas**, pas `pollMs` : le rattrapage au retour au
   * premier plan peut se déclencher bien plus souvent que la cadence.
   */
  minGapMs: number;
  /**
   * Délai de nouvelle tentative quand `occupied()` a fait sauter un tour.
   * Court exprès : c'est une lecture du DOM, elle ne coûte rien, et attendre
   * un cycle entier après la fermeture d'un panneau se lirait comme une
   * page qui ne se met plus à jour.
   */
  retryMs?: number;
  /**
   * Vrai quand ce n'est pas le moment. Le tour est reporté, pas annulé.
   * Sert à ne rien bousculer sous les doigts de l'utilisateur.
   */
  occupied?: () => boolean;
};

/**
 * Ordonnanceur de sondage, partagé par les deux mécanismes « live » de
 * l'app : la liste des notes de la page de review et la grille des projets.
 *
 * Un seul ordonnanceur, **deux transports**. Les deux pages n'ont pas les
 * mêmes contraintes — l'une ne doit pas toucher au lecteur vidéo et ne
 * récupère donc que du JSON, l'autre peut re-rendre sa route entière — mais
 * elles ont exactement la même politique de déclenchement. Dupliquer cette
 * politique, c'était s'engager à corriger deux fois le même défaut de
 * cadence ; c'est justement ce qui est arrivé une première fois.
 *
 * La politique, précisément :
 *
 * - **Onglet caché, aucun tour.** Une fenêtre en arrière-plan ne regarde
 *   rien, elle n'a pas à réveiller le serveur.
 * - **Rattrapage au retour au premier plan.** C'est le déclencheur qui fait
 *   le vrai travail : on revient sur l'app, c'est à jour. La cadence de fond
 *   n'est que le filet pour la fenêtre laissée ouverte devant soi.
 * - **Plancher anti-rafale.** Sans lui, alterner rapidement entre deux
 *   fenêtres tire un tour à chaque bascule — mesuré à l'instrumentation :
 *   une requête toutes les 5 s là où cinq minutes étaient demandées, le
 *   garde-fou étant devenu le vrai rythme.
 * - **Le plancher ne réarme pas.** Un tour refusé par le plancher rend la
 *   main au minuteur en cours ; le remplacer par un minuteur court
 *   transformerait le va-et-vient de fenêtres en tempête de tours.
 * - **`lastAt` est amorcé au montage**, pas à zéro : sinon le tout premier
 *   `focus` passe le plancher et tire un tour dans la seconde qui suit
 *   l'arrivée sur la page, alors que le serveur vient tout juste de rendre.
 *
 * `setTimeout` réarmé plutôt que `setInterval` : le report demande un délai
 * variable, ce qu'un intervalle fixe ne sait pas faire.
 */
export function useLivePoll(
  tick: () => void | Promise<void>,
  { pollMs, minGapMs, retryMs = 2000, occupied }: Options,
) {
  // Les deux fonctions changent d'identité à chaque rendu de l'appelant.
  // Les lire dans des refs garde l'effet monté une seule fois : sinon le
  // minuteur repartirait de zéro et `lastAt` serait réamorcé à chaque
  // rendu, ce qui reviendrait à ne plus avoir de cadence du tout.
  const tickRef = useRef(tick);
  const occupiedRef = useRef(occupied);
  tickRef.current = tick;
  occupiedRef.current = occupied;

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let lastAt = Date.now();

    // Tout en déclarations de fonction : elles sont hoistées, donc `arm` peut
    // nommer `onTimer` déclaré plus bas sans détour par une variable.
    function arm(delay: number) {
      window.clearTimeout(timer);
      if (stopped) return;
      timer = window.setTimeout(onTimer, delay);
    }

    function onTimer() {
      void run(true);
    }

    function onCatchUp() {
      void run(false);
    }

    /**
     * `scheduled` distingue le tour du minuteur du rattrapage déclenché par
     * un événement, et ce n'est pas un détail : quand `run` vient du
     * minuteur, celui-ci a déjà expiré. Sortir sans réarmer arrêterait le
     * sondage **définitivement**. Un rattrapage, lui, arrive alors que le
     * minuteur court toujours : il n'a rien à réarmer.
     */
    async function run(scheduled: boolean) {
      if (stopped) return;

      if (document.visibilityState !== "visible") {
        // Pas de réarmement : `visibilitychange` relancera tout au retour,
        // et une fenêtre qui ne revient jamais n'a pas à être sondée.
        return;
      }
      if (Date.now() - lastAt < minGapMs) {
        // Plancher franchi trop tôt — un rattrapage vient de passer. On rend
        // la main à la cadence normale sans jamais la raccourcir : c'est ce
        // raccourcissement qui transformait le va-et-vient en tempête.
        if (scheduled) arm(pollMs);
        return;
      }
      if (occupiedRef.current?.()) {
        // Reporté, pas annulé : un panneau est ouvert ou un envoi est en
        // cours, on repasse dans un instant.
        arm(retryMs);
        return;
      }

      lastAt = Date.now();
      try {
        await tickRef.current();
      } catch {
        // Un tour de fond ne dérange jamais l'utilisateur avec une erreur :
        // on garde ce qui est à l'écran et on retentera au tour suivant.
      }
      arm(pollMs);
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        onCatchUp();
        arm(pollMs);
      } else {
        window.clearTimeout(timer);
      }
    }

    arm(pollMs);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onCatchUp);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onCatchUp);
    };
  }, [pollMs, minGapMs, retryMs]);
}
