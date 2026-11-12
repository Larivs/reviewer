"use client";

import { useOptimistic, useTransition } from "react";
import { setVideoStatusAction } from "@/actions/videos";
import { VIDEO_STATUSES, type VideoStatus } from "@/db/schema";
import { STATUS_CLASSES, STATUS_LABELS } from "@/lib/format";
import { toast } from "./toast";

/**
 * Un `select` natif habillé en badge : il garde le clavier, le tactile et
 * la liste déroulante du système, pour un tiers du code d'un menu maison.
 *
 * La valeur affichée est **dérivée** de la prop, pas copiée dedans. C'était
 * un `useState(status)` : lu une seule fois au montage, et comme la carte
 * n'est jamais remontée, sa clé est l'id de la vidéo, un statut changé
 * depuis un autre poste n'apparaissait **jamais** sur une page restée
 * ouverte. Le sondage de la grille rendait ce défaut visible.
 *
 * `useOptimistic` supprime la classe de bug plutôt que de la rattraper :
 * hors action en vol, la valeur *est* la prop, donc la resynchronisation est
 * structurelle. Et le retour en arrière sur échec est gratuit, l'optimiste
 * est simplement abandonné, on retombe sur la prop inchangée.
 */
export function StatusPicker({
  videoId,
  status,
  size = "sm",
}: {
  videoId: string;
  status: VideoStatus;
  size?: "sm" | "md";
}) {
  const [current, showOptimistic] = useOptimistic(status);
  const [pending, startTransition] = useTransition();

  function change(next: VideoStatus) {
    // L'appel optimiste doit vivre DANS la transition : c'est ce qui lie sa
    // durée de vie à celle de l'action, et donc ce qui le fait retomber tout
    // seul si le serveur refuse.
    startTransition(async () => {
      showOptimistic(next);
      // Refus du serveur : le badge retombe tout seul sur l'ancien statut,
      // mais sans un mot on croirait à un clic raté.
      const result = await setVideoStatusAction(videoId, next);
      if (!result.ok) toast(result.error, "error");
    });
  }

  return (
    <span className="relative inline-flex">
      <select
        value={current}
        disabled={pending}
        onChange={(e) => change(e.target.value as VideoStatus)}
        aria-label="Statut de la vidéo"
        title="Changer le statut"
        className={`cursor-pointer appearance-none rounded-sm border bg-clip-padding pr-4 font-medium transition-opacity hover:opacity-80 disabled:opacity-50 ${
          STATUS_CLASSES[current]
        } ${size === "sm" ? "py-0.5 pl-1.5 text-xs" : "py-1 pl-2 text-[13px]"}`}
      >
        {VIDEO_STATUSES.map((value) => (
          <option key={value} value={value} className="bg-surface-2 text-fg">
            {STATUS_LABELS[value]}
          </option>
        ))}
      </select>

      {/* Chevron dessiné à part : `appearance-none` retire celui du système. */}
      <svg
        viewBox="0 0 10 6"
        aria-hidden
        className="pointer-events-none absolute right-1 top-1/2 w-2 -translate-y-1/2 opacity-70"
      >
        <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}
