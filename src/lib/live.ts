import "server-only";
import { EventEmitter } from "node:events";

/**
 * Le direct : qui regarde quoi, et quand quelque chose a changé.
 *
 * Tout tient dans le processus. Une instance = un serveur Node, il n'y a pas
 * de second processus à prévenir, donc pas de Redis ni de file : un émetteur
 * d'événements suffit, et il disparaît avec le serveur sans rien laisser.
 *
 * Les événements ne portent **aucune donnée de review**, seulement « ça a
 * changé ». Le navigateur redemande ensuite par les routes habituelles, qui
 * appliquent les droits. Un flux resté ouvert après la mort d'un lien
 * n'apprend donc rien à son porteur : sa requête suivante est refusée.
 *
 * Posé sur `globalThis` : les routes et les actions peuvent être chargées
 * dans des paquets serveur distincts, et deux émetteurs ne se parleraient pas.
 */
export type Watcher = { id: string; name: string; color: number };

type Hub = {
  bus: EventEmitter;
  /** Par vidéo, les connexions ouvertes. Une personne peut en avoir deux. */
  watchers: Map<string, Map<symbol, Watcher>>;
};

const store = globalThis as unknown as { __reviewerLive?: Hub };
const hub = (store.__reviewerLive ??= {
  bus: new EventEmitter().setMaxListeners(0),
  watchers: new Map(),
});

const LIBRARY = "library";
const videoChannel = (videoId: string) => `video:${videoId}`;

/** Les notes d'une vidéo ont bougé. */
export function notifyComments(videoId: string) {
  hub.bus.emit(videoChannel(videoId), "comments");
}

/** La bibliothèque a bougé : dépôt, rangement, statut, conversion finie. */
export function notifyFolderChanged() {
  hub.bus.emit(LIBRARY, "changed");
}

/** Personnes présentes sur une vidéo, une fois chacune. */
function present(videoId: string): Watcher[] {
  const seen = new Map<string, Watcher>();
  for (const w of hub.watchers.get(videoId)?.values() ?? []) seen.set(w.id, w);
  return [...seen.values()].sort((a, b) => a.color - b.color);
}

export type Send = (event: string, data: unknown) => void;

/** S'abonne aux changements de la bibliothèque. Rend de quoi se désabonner. */
export function watchLibrary(send: Send) {
  const onEvent = (event: string) => send(event, {});
  hub.bus.on(LIBRARY, onEvent);
  return () => hub.bus.off(LIBRARY, onEvent);
}

/**
 * Entre sur une vidéo : reçoit ses changements, et s'annonce aux autres.
 * La présence est celle des connexions ouvertes, rien n'est écrit en base,
 * un onglet fermé disparaît de lui-même.
 */
export function watchVideo(videoId: string, watcher: Watcher, send: Send) {
  const channel = videoChannel(videoId);
  const connection = Symbol();
  const onEvent = (event: string) =>
    send(event, event === "presence" ? present(videoId) : {});

  const here = hub.watchers.get(videoId) ?? new Map<symbol, Watcher>();
  hub.watchers.set(videoId, here);
  here.set(connection, watcher);

  hub.bus.on(channel, onEvent);
  hub.bus.emit(channel, "presence");

  return () => {
    hub.bus.off(channel, onEvent);
    here.delete(connection);
    if (here.size === 0) hub.watchers.delete(videoId);
    hub.bus.emit(channel, "presence");
  };
}
