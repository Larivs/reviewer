"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLivePoll } from "./use-live-poll";
import { useLiveEvents } from "./use-live-events";

/**
 * Cadence de fond. La même que le sondage des notes, à la demande de Toma :
 * ce qui compte à trois utilisateurs, c'est le rattrapage au retour au
 * premier plan, pas le minuteur.
 */
const POLL_MS = 5 * 60 * 1000;
/** Plancher anti-rafale : c'est lui qui borne le pire cas. */
const MIN_GAP_MS = 30_000;

/**
 * Garde la grille des projets à jour sans recharger la page : dépôt d'une
 * vidéo, dossier créé ou renommé, statut changé depuis un autre poste.
 *
 * Ne rend rien. Se contente de rappeler `router.refresh()`, ce qui redemande
 * le rendu serveur de la route et le réconcilie dans l'arbre existant.
 *
 * **Pourquoi pas une route JSON comme pour les notes.** Ce précédent existe
 * pour une raison nommée : ne pas re-rendre la route de la page de review, où
 * un lecteur vidéo est en train de jouer. Cette raison est absente ici, pas
 * de `<video>`, pas de Suspense autour de la grille. Reproduire la forme
 * quand le motif a disparu, ce serait dupliquer côté client une logique de
 * rendu qui existe déjà côté serveur, avec deux sources de vérité à tenir
 * d'accord. Mesuré dans le navigateur avant de trancher : un
 * `router.refresh()` ne remonte aucun nœud de la grille (une propriété posée
 * à la main sur un nœud du DOM y survit), ne rejoue pas la cascade `rise`
 *, zéro animation relancée, et laisse intacts un panneau de renommage
 * ouvert et son texte en cours de saisie.
 *
 * **Placement.** Monté ici, dans `folder-browser`, plutôt que dans les deux
 * pages : un seul fichier touché, les deux routes couvertes. Et
 * volontairement **dernier enfant du fragment, sans clé ni enveloppe** : les
 * sections conditionnelles occupent leur emplacement même quand elles valent
 * `false`, donc la zone d'envoi garde son numéro d'emplacement et sa fibre.
 * C'est ce qui fait survivre la file d'envoi et sa requête en vol à un
 * rafraîchissement. Ne pas enrober, ne pas re-clé.
 */
export function LiveGrid() {
  const router = useRouter();
  // `useRouter()` peut changer d'identité ; passer par un ref garde l'effet
  // de l'ordonnanceur monté une seule fois. Sinon le minuteur repartirait et
  // le plancher serait réamorcé à chaque changement.
  const routerRef = useRef(router);
  routerRef.current = router;

  /**
   * Vrai quand ce n'est pas le moment de bousculer la page.
   *
   * Deux signaux, tous les deux **publiés** par le code concerné plutôt que
   * devinés :
   *
   * - `[data-busy]` : un panneau est ouvert (renommage, suppression,
   *   déplacement, création de dossier) ou un envoi est en cours. Le cas de
   *   l'envoi est le plus important : c'est le seul état de la page dont la
   *   perte serait vraiment grave, et c'est le moment où l'on touche le moins
   *   à la page.
   * - `tourRunning` : le guide de première visite est à l'écran. Il mesure sa
   *   cible image par image ; la faire bouger sous lui pendant une
   *   explication n'apporte rien.
   *
   * Pas de test sur l'élément qui a le focus, contrairement à ce qu'on
   * pourrait croire utile : tous les champs de la grille sont déjà dans un
   * panneau marqué `data-busy`, et surtout une liste déroulante native
   * **garde le focus après sélection**, changer un statut aurait donc figé
   * la grille jusqu'au prochain clic ailleurs.
   */
  const occupied = useCallback(() => {
    if (document.documentElement.dataset.tourRunning === "1") return true;
    return document.querySelector("[data-busy]") !== null;
  }, []);

  const tick = useCallback(() => {
    routerRef.current.refresh();
  }, []);

  useLivePoll(tick, { pollMs: POLL_MS, minGapMs: MIN_GAP_MS, occupied });

  // Le direct : un dépôt, un statut, une conversion finie sur un autre poste
  // arrivent tout de suite. Même retenue que le sondage, on attend qu'aucun
  // panneau ne soit ouvert, et une rafale d'événements ne fait qu'un rendu.
  const pending = useRef(0);
  useLiveEvents("/api/events", {
    changed: () => {
      window.clearTimeout(pending.current);
      const attempt = () => {
        if (occupied()) pending.current = window.setTimeout(attempt, 2000);
        else tick();
      };
      pending.current = window.setTimeout(attempt, 300);
    },
  });
  useEffect(() => () => window.clearTimeout(pending.current), []);

  return null;
}
