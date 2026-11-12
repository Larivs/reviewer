"use client";

import { useRef, useState, useTransition } from "react";
import { createCommentAction } from "@/actions/comments";
import { describeAnnotation, type Annotation } from "@/lib/annotation";
import { FALLBACK_FPS, formatSpan, formatTimecode } from "@/lib/timecode";
import type { Tool } from "../annotation/annotation-layer";
import type { Range } from "../player/timeline";

type Props = {
  videoId: string;
  fps: number | null;
  /** Noms proposés après un `@`. */
  people: string[];
  /** Affiche la case « note interne », pour le studio seulement. */
  canInternal: boolean;
  /** Position affichée : rafraîchie à cadence réduite, suffisante à l'œil. */
  currentTime: number;
  /**
   * Position exacte, lue directement dans le lecteur. C'est elle qui sert à
   * épingler : `currentTime` peut avoir jusqu'à 200 ms de retard, soit cinq
   * images, inacceptable pour un outil au timecode.
   */
  getPreciseTime: () => number;
  onFocusCapture: () => void;
  /** Prévient l'espace de review de la note à mettre en avant. */
  onCreated: (id: string) => void;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  draft: Annotation | null;
  onDraftChange: (annotation: Annotation | null) => void;
  /** Plage tracée sur la piste, ou `null` pour une note à l'instant. */
  range: Range | null;
  onRangeChange: (range: Range | null) => void;
  /** La piste attend un glissement. */
  rangeArmed: boolean;
  onRangeArmedChange: (armed: boolean) => void;
};

export function CommentForm({
  videoId,
  fps,
  people,
  canInternal,
  currentTime,
  getPreciseTime,
  onFocusCapture,
  onCreated,
  tool,
  onToolChange,
  draft,
  onDraftChange,
  range,
  onRangeChange,
  rangeArmed,
  onRangeArmedChange,
}: Props) {
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState<number | null>(null);
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Tant qu'on n'a rien écrit, la puce suit la lecture. Dès la première
  // frappe elle se fige : le temps d'écrire la note, la vidéo a pu avancer,
  // et c'est bien l'image qu'on regardait qu'on veut référencer.
  //
  // Une plage tracée sur la piste l'emporte : elle dit explicitement où
  // commence la note, il n'y a plus rien à deviner.
  const timecode = range ? range.start : (pinned ?? currentTime);

  // Si on s'est déplacé après avoir commencé à écrire, l'épingle ne
  // correspond plus à l'image affichée. Sans signal, on posterait une note
  // sur la mauvaise image en croyant viser celle qu'on regarde. Sans objet
  // pour une plage, dont les deux bornes sont visibles sur la piste.
  const frameDuration = 1 / (fps ?? FALLBACK_FPS);
  const drifted =
    !range && pinned !== null && Math.abs(pinned - currentTime) > frameDuration;

  function pin() {
    const at = getPreciseTime();
    setPinned(at);
    return at;
  }

  function handleChange(value: string) {
    if (!range && pinned === null && value.length > 0) pin();
    if (value.length === 0) setPinned(null);
    setBody(value);
    setError(null);
  }

  /**
   * Mention en cours de frappe : ce qui suit le dernier `@` avant le curseur,
   * tant qu'on n'a pas tapé d'espace. On propose alors les personnes dont le
   * nom commence ainsi ; Tab ou un clic complète.
   */
  const [caret, setCaret] = useState(0);
  const typed = /(^|\s)@([^\s@]*)$/.exec(body.slice(0, caret));
  const suggestions = typed
    ? people.filter((name) => name.toLowerCase().startsWith(typed[2].toLowerCase())).slice(0, 5)
    : [];

  function complete(name: string) {
    if (!typed) return;
    const start = caret - typed[2].length;
    const next = `${body.slice(0, start)}${name} ${body.slice(caret)}`;
    setBody(next);
    const position = start + name.length + 1;
    setCaret(position);
    requestAnimationFrame(() => {
      areaRef.current?.focus();
      areaRef.current?.setSelectionRange(position, position);
    });
  }

  function clearRange() {
    onRangeChange(null);
    onRangeArmedChange(false);
  }

  function submit() {
    if (!body.trim() || pending) return;
    const at = timecode;
    const until = range ? range.end : null;
    const shapes = draft;

    startTransition(async () => {
      const result = await createCommentAction({
        videoId,
        timecode: at,
        timecodeEnd: until,
        body,
        annotation: shapes,
        internal,
      });

      if (result.ok) {
        setBody("");
        setPinned(null);
        // Chaque note se décide : rester coché ferait partir la suivante en
        // interne par oubli, et le client ne verrait pas ce qu'on lui écrit.
        setInternal(false);
        setError(null);
        clearRange();
        onDraftChange(null);
        onToolChange("none");
        onCreated(result.id);
        areaRef.current?.focus();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-tour="note-form"
      className="rounded-lg border border-line bg-surface-2 p-2.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {range ? (
          /* Une seule puce pour l'intervalle : deux puces séparées se
             lisaient comme deux notes, et on cherchait laquelle était le
             début. La durée est là parce que c'est elle qu'on juge, « trois
             secondes » parle, « de 0:04 à 0:07 » demande une soustraction. */
          <span className="flex items-center gap-1.5 rounded-sm bg-accent/15 px-1.5 py-0.5 font-mono text-xs tabular-nums tracking-[0.02em] text-accent">
            {formatTimecode(range.start, fps)}
            <span aria-hidden className="opacity-60">
              →
            </span>
            {formatTimecode(range.end, fps)}
            <span className="opacity-60">· {formatSpan(range.end - range.start)}</span>
            <button
              type="button"
              onClick={clearRange}
              aria-label="Retirer la plage"
              title="Revenir à un instant unique"
              className="ml-0.5 opacity-70 transition-opacity hover:opacity-100"
            >
              ✕
            </button>
          </span>
        ) : (
          <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 font-mono text-xs tabular-nums tracking-[0.02em] text-accent">
            {formatTimecode(timecode, fps)}
          </span>
        )}

        {drifted ? (
          <button
            type="button"
            onClick={pin}
            title={`Recaler sur ${formatTimecode(currentTime, fps)}`}
            className="rounded-sm border border-status-doing/40 bg-status-doing/10 px-1.5 py-0.5 text-xs font-medium text-status-doing transition-colors hover:bg-status-doing/20"
          >
            ≠ lecture · recaler
          </button>
        ) : (
          !range && pinned !== null && <span className="label">épinglé</span>
        )}
      </div>

      <textarea
        ref={areaRef}
        value={body}
        onChange={(e) => {
          handleChange(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onFocus={onFocusCapture}
        onKeyDown={(e) => {
          if (e.key === "Tab" && suggestions.length > 0) {
            e.preventDefault();
            complete(suggestions[0]);
            return;
          }
          // Entrée insère un retour à la ligne : une note de review est
          // souvent une petite liste. Ctrl+Entrée envoie.
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        placeholder="Note à ce timecode…"
        className="field mt-2 resize-y !bg-surface"
      />

      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="label">Mentionner</span>
          {suggestions.map((name, i) => (
            <button
              key={name}
              type="button"
              onClick={() => complete(name)}
              className={`rounded-sm border px-1.5 py-0.5 text-xs transition-colors ${
                i === 0
                  ? "border-accent-dim bg-accent/12 text-accent"
                  : "border-line text-fg-dim hover:border-line-strong"
              }`}
            >
              @{name}
            </button>
          ))}
          <span className="meta">Tab</span>
        </div>
      )}

      {draft && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="label !text-accent">✎ {describeAnnotation(draft)}</span>
          <button
            type="button"
            onClick={() => onDraftChange(null)}
            className="label transition-colors hover:!text-status-changes"
          >
            effacer
          </button>
        </div>
      )}

      {/* Consigne du mode plage. Elle est ici et pas seulement sur la piste
          parce que c'est ici qu'on vient de cliquer : l'œil n'a pas encore
          quitté le formulaire. */}
      {rangeArmed && !range && (
        <p className="mt-1.5 text-xs text-accent">
          Glisse sur la piste, du début à la fin de ce que tu commentes.
          L&apos;image suit pendant le geste.
        </p>
      )}

      {canInternal && (
        <label
          className={`mt-2 flex items-center gap-2 text-xs ${
            internal ? "text-status-doing" : "text-muted"
          }`}
        >
          <input
            type="checkbox"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
            className="accent-[var(--color-status-doing)]"
          />
          Note interne, invisible pour les clients
        </label>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-status-changes">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => {
            // Ouvrir les outils épingle le timecode : on dessine sur une
            // image donnée, la note doit pointer celle-là.
            if (tool === "none" && !range && pinned === null) pin();
            onToolChange(tool === "none" ? "pin" : "none");
          }}
          aria-pressed={tool !== "none"}
          data-tour="annotate"
          className={`btn !py-1 ${tool !== "none" ? "btn-primary" : "btn-ghost"}`}
        >
          {tool === "none" ? "Annoter" : "Dessin actif"}
        </button>

        {/* Ancienne mécanique : épingler, aller chercher la fin à la lecture,
            puis cliquer « définir une plage », trois gestes dans trois coins
            de l'écran, et rien à l'écran pour dire où on en était. Ici, un
            bouton arme, un glissement pose l'intervalle, et les poignées le
            corrigent. */}
        <button
          type="button"
          onClick={() => {
            if (range) clearRange();
            else onRangeArmedChange(!rangeArmed);
          }}
          aria-pressed={rangeArmed || range !== null}
          title={
            range
              ? "Retirer la plage"
              : "Choisir un intervalle en glissant sur la piste"
          }
          className={`btn !py-1 ${
            rangeArmed || range ? "btn-primary" : "btn-ghost"
          }`}
        >
          {range ? "Plage posée" : rangeArmed ? "Trace la plage…" : "Plage"}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-sm border border-line bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-muted">
            Ctrl + Entrée
          </span>
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="btn btn-primary !py-1"
          >
            {pending ? "…" : "Commenter"}
          </button>
        </div>
      </div>
    </form>
  );
}
