"use client";

import { useEffect, useRef } from "react";

/**
 * Écoute le flux d'événements du serveur (`/api/events`).
 *
 * `EventSource` se reconnecte tout seul après une coupure ou un redémarrage
 * du serveur : il n'y a rien à réarmer ici. Le sondage de fond reste en
 * place à côté, c'est le filet pour les proxys qui retiennent les flux.
 *
 * Les gestionnaires sont lus dans une ref : ils changent d'identité à chaque
 * rendu, et rouvrir la connexion à chaque fois ferait clignoter la présence
 * chez tous les autres.
 */
export function useLiveEvents(
  url: string,
  handlers: Record<string, (data: unknown) => void>,
) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const names = Object.keys(handlers).join(",");

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(url);
    const listeners = names.split(",").map((name) => {
      const listener = (event: MessageEvent) => {
        let data: unknown = null;
        try {
          data = JSON.parse(event.data);
        } catch {
          // Un événement sans corps lisible reste un signal.
        }
        ref.current[name]?.(data);
      };
      source.addEventListener(name, listener);
      return [name, listener] as const;
    });
    return () => {
      for (const [name, listener] of listeners) source.removeEventListener(name, listener);
      source.close();
    };
  }, [url, names]);
}
