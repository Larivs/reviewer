"use client";

import { useMemo, useState } from "react";
import type { CommentWithAuthor } from "@/lib/comments";
import type { Annotation } from "@/lib/annotation";
import { userColor } from "@/lib/user-colors";
import type { Tool } from "../annotation/annotation-layer";
import type { Range } from "../player/timeline";
import { CommentForm } from "./comment-form";
import { CommentItem } from "./comment-item";

/** Ce qu'on regarde. Le libellé est celui du panneau. */
const VIEWS = [
  { key: "all", label: "Toutes" },
  { key: "open", label: "Ouvertes" },
  { key: "resolved", label: "Résolues" },
] as const;

type View = (typeof VIEWS)[number]["key"];

type Props = {
  videoId: string;
  fps: number | null;
  comments: CommentWithAuthor[];
  currentUserId: string;
  currentTime: number;
  /** Note sous la tête de lecture, calculée par l'espace de review. */
  activeId: string | null;
  getPreciseTime: () => number;
  onSeek: (time: number) => void;
  onFormFocus: () => void;
  /** Note tout juste écrite : mise en avant et amenée à l'écran. */
  freshId: string | null;
  onCreated: (id: string) => void;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  draft: Annotation | null;
  onDraftChange: (annotation: Annotation | null) => void;
  range: Range | null;
  rangeArmed: boolean;
  onRangeChange: (range: Range | null) => void;
  onRangeArmedChange: (armed: boolean) => void;
};

export function CommentsPanel({
  videoId,
  fps,
  comments,
  currentUserId,
  currentTime,
  activeId,
  getPreciseTime,
  onSeek,
  onFormFocus,
  freshId,
  onCreated,
  tool,
  onToolChange,
  draft,
  onDraftChange,
  range,
  rangeArmed,
  onRangeChange,
  onRangeArmedChange,
}: Props) {
  const [view, setView] = useState<View>("all");
  /** Auteurs décochés. Vide = tout le monde, le cas de loin le plus fréquent. */
  const [muted, setMuted] = useState<Set<string>>(new Set());

  const open = comments.filter((c) => !c.resolved).length;

  /**
   * Le numéro d'une note est son rang dans l'ordre du timecode, sur la liste
   * **entière**. Il ne bouge donc pas quand on filtre : « la note 7 » reste
   * la note 7 même si on a masqué les résolues, sinon deux personnes qui ne
   * filtrent pas pareil ne parlent plus de la même chose.
   */
  const ranks = useMemo(
    () => new Map(comments.map((comment, i) => [comment.id, i + 1])),
    [comments],
  );

  /** Les auteurs présents sur cette vidéo, dans l'ordre des couleurs. */
  const authors = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: number }>();
    for (const comment of comments) {
      if (!seen.has(comment.userId))
        seen.set(comment.userId, {
          id: comment.userId,
          name: comment.authorName,
          color: comment.authorColor,
        });
      for (const reply of comment.replies) {
        if (!seen.has(reply.userId))
          seen.set(reply.userId, {
            id: reply.userId,
            name: reply.authorName,
            color: reply.authorColor,
          });
      }
    }
    return [...seen.values()].sort((a, b) => a.color - b.color);
  }, [comments]);

  const selected = useMemo(() => {
    const byAuthor = comments.filter((c) => !muted.has(c.userId));
    if (view === "open") return byAuthor.filter((c) => !c.resolved);
    if (view === "resolved") return byAuthor.filter((c) => c.resolved);
    return byAuthor;
  }, [comments, muted, view]);

  /**
   * En vue « toutes », les résolues descendent en bas derrière un intertitre
   * au lieu de rester intercalées au fil du timecode. Une note appliquée
   * n'appelle plus d'action : la laisser au milieu obligeait à la sauter à
   * chaque passage, et ce qui restait à traiter se perdait entre elles.
   * L'ordre du timecode est conservé à l'intérieur de chaque groupe.
   */
  const { pending, done } = useMemo(() => {
    if (view !== "all") return { pending: selected, done: [] as CommentWithAuthor[] };
    return {
      pending: selected.filter((c) => !c.resolved),
      done: selected.filter((c) => c.resolved),
    };
  }, [selected, view]);

  function toggleAuthor(id: string) {
    setMuted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderItem(comment: CommentWithAuthor) {
    return (
      <CommentItem
        key={comment.id}
        comment={comment}
        index={ranks.get(comment.id) ?? 0}
        fps={fps}
        currentUserId={currentUserId}
        active={comment.id === activeId}
        reveal={comment.id === freshId}
        onSeek={onSeek}
      />
    );
  }

  return (
    <aside
      data-tour="notes"
      className="flex max-h-[calc(100vh-7.5rem)] flex-col rounded-lg border border-line bg-surface p-3 lg:sticky lg:top-[4.75rem]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="label !text-fg-dim">
          Notes
          {comments.length > 0 && (
            <span className="ml-2 !text-muted">
              {open}/{comments.length} ouvertes
            </span>
          )}
        </h2>
      </div>

      <div className="mt-3">
        <CommentForm
          videoId={videoId}
          fps={fps}
          currentTime={currentTime}
          getPreciseTime={getPreciseTime}
          onFocusCapture={onFormFocus}
          onCreated={onCreated}
          tool={tool}
          onToolChange={onToolChange}
          draft={draft}
          onDraftChange={onDraftChange}
          range={range}
          onRangeChange={onRangeChange}
          rangeArmed={rangeArmed}
          onRangeArmedChange={onRangeArmedChange}
        />
      </div>

      {comments.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Sélecteur à trois états plutôt que l'ancien interrupteur
              « masquer les résolus » : celui-ci ne disait pas dans quel état
              on était sans lire son libellé, et surtout il n'offrait pas de
              ne voir *que* les résolues — ce qu'on veut faire au moment de
              vérifier une livraison. */}
          <div
            role="tablist"
            aria-label="Filtrer les notes"
            className="flex overflow-hidden rounded-sm border border-line"
          >
            {VIEWS.map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`label !tracking-[0.1em] px-2 py-1 transition-colors ${
                  view === key
                    ? "bg-accent/15 !text-accent"
                    : "hover:bg-surface-2 hover:!text-fg-dim"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Filtre par auteur. Les pastilles sont les mêmes que sur les
              notes et les repères de la piste : c'est la même couleur qui
              sert à reconnaître et à filtrer. Inutile à un seul auteur. */}
          {authors.length > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              {authors.map((author) => {
                const on = !muted.has(author.id);
                const hex = userColor(author.color).hex;
                return (
                  <button
                    key={author.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleAuthor(author.id)}
                    title={on ? `Masquer ${author.name}` : `Afficher ${author.name}`}
                    className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] transition-all"
                    style={{
                      color: on ? hex : "var(--color-muted)",
                      borderColor: on
                        ? `color-mix(in srgb, ${hex} 55%, transparent)`
                        : "var(--color-line)",
                      background: on
                        ? `color-mix(in srgb, ${hex} 14%, transparent)`
                        : "transparent",
                      // Barré quand l'auteur est masqué : la seule perte de
                      // couleur ne suffit pas à dire « exclu ».
                      textDecoration: on ? "none" : "line-through",
                    }}
                  >
                    {author.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {pending.length === 0 && done.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {comments.length === 0
            ? "Aucun commentaire. Place-toi sur une image et écris ta note."
            : muted.size > 0
              ? "Rien pour les auteurs affichés."
              : view === "resolved"
                ? "Aucune note résolue pour l'instant."
                : "Tous les commentaires sont résolus."}
        </p>
      ) : (
        <ul className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
          {pending.map(renderItem)}

          {done.length > 0 && (
            <>
              <li className="flex items-center gap-2 pt-1.5">
                <span className="label !text-status-done">
                  ✓ {done.length} résolue{done.length > 1 ? "s" : ""}
                </span>
                <span aria-hidden className="h-px flex-1 bg-line" />
              </li>
              {done.map(renderItem)}
            </>
          )}
        </ul>
      )}
    </aside>
  );
}
