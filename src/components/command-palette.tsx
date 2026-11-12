"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchLibraryAction, type SearchHit } from "@/actions/search";
import { FolderIcon } from "./icons";
import { PlayIcon } from "./player/player-icons";

type Entry = { key: string; href: string; name: string; context: string; kind: SearchHit["kind"] | "page" };

/**
 * Palette de commandes : Ctrl + K, on tape, Entrée.
 *
 * Avec des dossiers imbriqués sans limite, retrouver un montage demandait de
 * redescendre l'arbre à chaque fois. La palette y va en trois frappes, de
 * n'importe quelle page, sans quitter le clavier.
 *
 * Un `<dialog>` natif : il apporte le piège à focus, Échap et le voile, ce
 * qu'une `div` oblige à réécrire et qu'on réécrit toujours à moitié.
 */
export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [mac, setMac] = useState(false);

  const pages: Entry[] = [
    { key: "home", href: "/", name: "Projets", context: "Aller à", kind: "page" },
    ...(isAdmin
      ? [{ key: "admin", href: "/admin", name: "Comptes et liens", context: "Aller à", kind: "page" as const }]
      : []),
  ];
  const entries: Entry[] = query.trim()
    ? hits.map((h) => ({
        key: `${h.kind}-${h.id}`,
        href: h.kind === "folder" ? `/f/${h.id}` : `/v/${h.id}`,
        name: h.name,
        context: h.context,
        kind: h.kind,
      }))
    : pages;

  function open() {
    setQuery("");
    setHits([]);
    setCursor(0);
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }

  function go(entry: Entry | undefined) {
    if (!entry) return;
    dialogRef.current?.close();
    router.push(entry.href);
  }

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialogRef.current?.open) dialogRef.current.close();
        else open();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Recherche à la frappe, légèrement retenue. `stale` écarte une réponse
  // arrivée après que la saisie a changé : sans lui, taper vite affichait
  // les résultats d'une lettre de retard.
  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setHits([]);
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      searchLibraryAction(text)
        .then((found) => {
          if (stale) return;
          setHits(found);
          setCursor(0);
        })
        .catch(() => {});
    }, 120);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <>
      <button
        type="button"
        onClick={open}
        title="Chercher un projet ou une vidéo"
        className="flex items-center gap-2 rounded-sm border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:border-line-strong hover:text-fg"
      >
        Rechercher
        <kbd className="rounded-sm border border-line bg-surface-3 px-1 font-mono text-[10px]">
          {mac ? "⌘" : "Ctrl"} K
        </kbd>
      </button>

      <dialog
        ref={dialogRef}
        // Un clic sur le voile ferme : la cible est alors le dialog lui-même.
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        className="palette m-auto mt-[14vh] w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line-strong bg-surface p-0 text-fg shadow-[0_24px_80px_-12px_rgb(0_0_0/0.8)] backdrop:bg-bg/70 backdrop:backdrop-blur-[2px]"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((i) => Math.min(entries.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(entries[cursor]);
            }
          }}
          placeholder="Un projet, une vidéo…"
          aria-label="Rechercher"
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={entries[cursor] ? `palette-${entries[cursor].key}` : undefined}
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-muted"
        />

        <ul id="palette-results" role="listbox" className="max-h-[46vh] overflow-y-auto p-1.5">
          {entries.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted">
              Rien ne s&apos;appelle comme ça.
            </li>
          )}
          {entries.map((entry, i) => (
            <li
              key={entry.key}
              id={`palette-${entry.key}`}
              role="option"
              aria-selected={i === cursor}
              onPointerMove={() => setCursor(i)}
              onClick={() => go(entry)}
              className={`flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 ${
                i === cursor ? "bg-accent/12" : ""
              }`}
            >
              <span className={`grid size-6 shrink-0 place-items-center ${i === cursor ? "text-accent" : "text-muted"}`}>
                {entry.kind === "video" ? (
                  <PlayIcon className="size-3.5" />
                ) : (
                  <FolderIcon className="size-4" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
              <span className="meta max-w-[45%] shrink-0 truncate">{entry.context}</span>
            </li>
          ))}
        </ul>

        <p className="meta flex items-center gap-3 border-t border-line px-4 py-2">
          <span>↑ ↓ choisir</span>
          <span>Entrée ouvrir</span>
          <span>Échap fermer</span>
        </p>
      </dialog>
    </>
  );
}
