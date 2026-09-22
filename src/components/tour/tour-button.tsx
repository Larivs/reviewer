"use client";

/**
 * Relance le guide de la page courante. Un tour qu'on ne peut pas rejouer
 * est un tour qu'on subit : on le passe au premier écran, et l'information
 * est perdue pour de bon.
 */
export function TourButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("reviewer:tour"))}
      title="Revoir le guide de cette page"
      className="label transition-colors hover:!text-fg"
    >
      Guide
    </button>
  );
}
