"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLiveEvents } from "./use-live-events";

/**
 * À la place du lecteur tant que le fichier n'est pas lisible.
 *
 * Un ProRes ou un HEVC est converti en H.264 après l'envoi. Montrer le
 * lecteur pendant ce temps afficherait « lecture impossible » sur une vidéo
 * qui va très bien. La page se recharge d'elle-même à la fin : le serveur
 * prévient par le flux d'événements, et un minuteur lent sert de filet.
 */
export function ProcessingNotice({ failed }: { failed: boolean }) {
  const router = useRouter();

  useLiveEvents("/api/events", { changed: () => router.refresh() });
  useEffect(() => {
    if (failed) return;
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [failed, router]);

  return (
    <div className="mt-4 grid min-h-[40vh] place-items-center rounded-lg border border-line bg-surface px-6 text-center">
      <div className="max-w-[420px]">
        <p className={`label ${failed ? "!text-status-changes" : "!text-accent"}`}>
          {failed ? "Conversion échouée" : "Conversion en cours"}
        </p>
        <h2 className="heading mt-2 text-[20px]">
          {failed ? "Ce fichier n'a pas pu être converti" : "La vidéo arrive"}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {failed
            ? "Le format n'a pas pu être lu, ou le serveur s'est arrêté pendant la conversion. Supprime cette vidéo et renvoie le fichier."
            : "Ce format ne se lit pas dans un navigateur : le serveur en fabrique une copie H.264. La page s'ouvrira d'elle-même dès qu'elle est prête, tu peux la laisser ou revenir plus tard."}
        </p>
        {!failed && (
          <span aria-hidden className="mx-auto mt-5 block h-[3px] w-40 overflow-hidden rounded-sm bg-surface-3">
            <span className="indeterminate block h-full w-1/3 bg-accent" />
          </span>
        )}
      </div>
    </div>
  );
}
