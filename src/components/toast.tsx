"use client";

import { useEffect, useState } from "react";

type Tone = "info" | "ok" | "error";
type Toast = { id: number; message: string; tone: Tone };

/**
 * Messages brefs en bas de l'écran : « lien copié », « 3 vidéos envoyées ».
 *
 * Jusqu'ici une action réussie ne disait rien, ou changeait le libellé d'un
 * bouton qu'on ne regardait déjà plus. Le toast répond là où l'œil revient,
 * et disparaît seul.
 *
 * Un magasin au niveau du module plutôt qu'un contexte React : `toast()`
 * s'appelle depuis n'importe quel composant, ou hors de React, sans rien
 * avoir à enrober, et `<Toaster />` n'est monté qu'une fois, dans la mise en
 * page racine.
 */
let nextId = 1;
let current: Toast[] = [];
const listeners = new Set<(toasts: Toast[]) => void>();

function publish(next: Toast[]) {
  current = next;
  for (const listener of listeners) listener(current);
}

/** Une erreur reste plus longtemps : il faut le temps de la lire. */
const LIFETIME: Record<Tone, number> = { info: 3200, ok: 3200, error: 6500 };

export function toast(message: string, tone: Tone = "ok") {
  const id = nextId++;
  // Trois au plus : au-delà, c'est une pile qu'on ne lit pas.
  publish([...current.slice(-2), { id, message, tone }]);
  window.setTimeout(() => publish(current.filter((t) => t.id !== id)), LIFETIME[tone]);
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>(current);

  useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  return (
    // `aria-live` : un lecteur d'écran annonce le message sans voler le focus.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className="toast-in pointer-events-auto flex max-w-[min(480px,100%)] items-center gap-2.5 rounded-md border border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm shadow-[0_12px_40px_-10px_rgb(0_0_0/0.8)]"
        >
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${
              t.tone === "error" ? "bg-status-changes" : t.tone === "ok" ? "bg-status-done" : "bg-accent"
            }`}
          />
          <span className="min-w-0">{t.message}</span>
          <button
            type="button"
            onClick={() => publish(current.filter((x) => x.id !== t.id))}
            aria-label="Fermer"
            className="ml-1 shrink-0 text-muted transition-colors hover:text-fg"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
