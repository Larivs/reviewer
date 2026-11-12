"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { splitMentions } from "@/lib/mentions";
import {
  createReplyAction,
  deleteCommentAction,
  deleteReplyAction,
  toggleCommentResolvedAction,
  updateCommentAction,
} from "@/actions/comments";
import type { CommentWithAuthor } from "@/lib/comments";
import { formatDateTime, formatShortDateTime } from "@/lib/format";
import { formatSpan, formatTimecode } from "@/lib/timecode";
import { describeAnnotation, parseAnnotation } from "@/lib/annotation";
import { userColor } from "@/lib/user-colors";
import { PencilIcon, TrashIcon } from "../icons";
import { UserChip } from "../user-chip";

type Props = {
  comment: CommentWithAuthor;
  /** Rang dans l'ordre du timecode, affiché pour pouvoir la citer. */
  index: number;
  fps: number | null;
  currentUserId: string;
  /** Vrai quand la tête de lecture est sur ce commentaire. */
  active: boolean;
  /** Note tout juste écrite : on l'amène à l'écran. */
  reveal: boolean;
  onSeek: (time: number) => void;
};

export function CommentItem({
  comment,
  index,
  fps,
  currentUserId,
  active,
  reveal,
  onSeek,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLLIElement>(null);

  // La liste est défilante et peut être longue : une note écrite au bout de
  // la vidéo naissait hors de l'écran. `nearest` ne défile que si besoin,
  // et ne touche pas au défilement de la page.
  useEffect(() => {
    if (reveal) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [reveal]);

  const mine = comment.userId === currentUserId;
  const annotation = parseAnnotation(comment.annotation);
  const teinte = userColor(comment.authorColor).hex;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        done?.();
      } else {
        setError(result.error ?? "Action impossible.");
      }
    });
  }

  function sendReply() {
    const value = replyRef.current?.value ?? "";
    if (!value.trim() || pending) return;
    run(
      () => createReplyAction(comment.id, value),
      () => {
        if (replyRef.current) replyRef.current.value = "";
        setReplying(false);
      },
    );
  }

  /**
   * Toute la note ramène à son timecode. La pastille seule ne couvrait que
   * 6 % de la carte (une cible de 87 × 21 px dans un bloc de 324 × 94), il
   * fallait viser. Deux garde-fous : on ne déclenche pas depuis un contrôle,
   * ni quand du texte vient d'être sélectionné, sinon copier une note
   * déplacerait la tête de lecture.
   *
   * La pastille reste le point d'entrée au clavier : c'est elle qui porte le
   * focus, la carte n'ajoute qu'une commodité à la souris.
   */
  function seekFromCard(event: React.MouseEvent<HTMLLIElement>) {
    if (editing || confirming || replying) return;
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    if (window.getSelection()?.toString()) return;
    onSeek(comment.timecode);
  }

  return (
    <li
      ref={cardRef}
      onClick={seekFromCard}
      className={`relative rounded-lg border py-2 pl-3 pr-2.5 transition-colors ${
        editing || confirming || replying ? "" : "cursor-pointer"
      } ${
        active
          ? "border-accent-dim bg-accent/[0.09]"
          : comment.resolved
            // Une note résolue recule par son cadre, pas par son texte :
            // on la relit pour vérifier qu'elle est bien appliquée.
            ? "border-line/60 bg-surface-2/40 hover:border-line"
            : "border-line bg-surface-2 hover:border-line-strong"
      }`}
    >
      {/* Liseré d'auteur sur le bord gauche. C'est le repère qu'on balaie
          quand on cherche « les notes de Jérôme » dans une liste de vingt :
          la pastille de l'en-tête arrive trop tard, elle demande de lire.
          Il s'épaissit quand la note est sous la tête de lecture, même
          objet, deux intensités, plutôt qu'un second liseré d'accent qui
          entrerait en concurrence avec lui. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 rounded-l-lg transition-all ${active ? "w-[4px]" : "w-[2px]"}`}
        style={{ background: teinte, opacity: comment.resolved ? 0.3 : active ? 1 : 0.8 }}
      />

      {/* Première ligne : *quoi* et *qui*. Elle peut passer sur deux rangs
          quand la note couvre une plage, deux timecodes et leur durée ne
          tiennent pas sur 300 px à côté d'un nom. Mieux vaut un retour à la
          ligne qu'un nom rogné : « H… » ne désigne personne. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* Le rang était en `line-strong` sur `surface-2` : deux valeurs
            presque identiques, donc un numéro invisible. C'est pourtant lui
            qui sert à citer la note à l'oral, il devient une pastille. */}
        {/* La même pastille que sur la piste : même numéro, même couleur
            d'auteur, même forme. On passe de l'une à l'autre sans chercher.
            En gris de 11 px sur gris, on ne la lisait pas. */}
        <span
          className={`grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full px-1 text-[12.5px] font-bold leading-none tabular-nums text-[#07090e] ${
            active ? "ring-2 ring-fg" : ""
          }`}
          style={{
            background: userColor(comment.authorColor).hex,
            opacity: comment.resolved ? 0.55 : 1,
          }}
        >
          {index}
        </span>

        {/* Le timecode est le point d'entrée : un clic ramène à l'image. */}
        <button
          type="button"
          onClick={() => onSeek(comment.timecode)}
          title="Aller à ce timecode"
          className="shrink-0 rounded-sm bg-accent/15 px-1.5 py-0.5 font-mono text-[12.5px] tabular-nums tracking-[0.02em] text-accent transition-colors hover:bg-accent/25"
        >
          {formatTimecode(comment.timecode, fps)}
          {comment.timecodeEnd !== null && (
            <span className="opacity-75">
              {" → "}
              {formatTimecode(comment.timecodeEnd, fps)}
            </span>
          )}
        </button>

        {comment.timecodeEnd !== null && (
          <span className="meta shrink-0" title="Durée de la plage">
            {formatSpan(comment.timecodeEnd - comment.timecode)}
          </span>
        )}

        {annotation && (
          <span
            title={`Annotation : ${describeAnnotation(annotation)}`}
            className="shrink-0 text-xs leading-none"
            style={{ color: teinte }}
          >
            ✎
          </span>
        )}

        <UserChip
          name={comment.authorName}
          colorIndex={comment.authorColor}
          withName
          shrink={false}
        />

        {/* Violet, la teinte de « en cours » : ni l'accent, qui demande une
            action, ni une couleur d'auteur. Il dit seulement que cette note
            ne sort pas du studio. */}
        {comment.internal && (
          <span
            title="Les clients ne voient pas cette note"
            className="shrink-0 rounded-sm border border-status-doing/40 bg-status-doing/10 px-1.5 py-px text-[11.5px] font-medium text-status-doing"
          >
            interne
          </span>
        )}

        {comment.resolved && (
          <span
            title="Résolu"
            className="ml-auto shrink-0 rounded-sm border border-status-done/35 bg-status-done/10 px-1.5 py-px text-[11.5px] font-medium text-status-done"
          >
            ✓ résolu
          </span>
        )}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => updateCommentAction(comment.id, areaRef.current?.value ?? ""),
              () => setEditing(false),
            );
          }}
          className="mt-2"
        >
          <textarea
            ref={areaRef}
            defaultValue={comment.body}
            rows={3}
            autoFocus
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            className="field resize-y !bg-surface"
          />
          <div className="mt-2 flex gap-2">
            <button type="submit" disabled={pending} className="btn btn-primary !py-1">
              {pending ? "…" : "Enregistrer"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="btn btn-ghost !py-1"
            >
              Annuler
            </button>
          </div>
        </form>
      ) : (
        /* 14 px et une interligne large : c'est le seul texte de la carte
           qu'on lit vraiment, tout le reste est de la signalétique. Une note
           résolue passe en `fg-dim` plutôt que sous une opacité globale, à
           55 % d'opacité on ne pouvait plus la relire, alors que c'est
           justement ce qu'on fait pour vérifier qu'elle est bien appliquée. */
        <p
          className={`mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed ${
            comment.resolved ? "text-fg-dim" : "text-fg"
          }`}
        >
          <MentionText body={comment.body} names={comment.mentions} />
        </p>
      )}

      {/* ── Le fil ──────────────────────────────────────────────────────
          Répondre sous la note d'un autre, au lieu d'en écrire une seconde
          au même timecode : la piste garde un repère par problème, et la
          discussion reste attachée à ce qu'elle discute. Les réponses sont
          en retrait derrière un filet, on voit d'un coup d'œil où finit la
          note et où commence ce qu'on en a dit. */}
      {comment.replies.length > 0 && !editing && (
        <ul className="mt-2 space-y-2 border-l border-line pl-2.5">
          {comment.replies.map((reply) => (
            <li key={reply.id}>
              <div className="flex items-center gap-2">
                <UserChip
                  name={reply.authorName}
                  colorIndex={reply.authorColor}
                  withName
                  shrink={false}
                />
                <span
                  className="meta ml-auto shrink-0"
                  title={formatDateTime(reply.createdAt)}
                >
                  {formatShortDateTime(reply.createdAt)}
                </span>
                {reply.userId === currentUserId && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteReplyAction(reply.id))}
                    aria-label="Supprimer ma réponse"
                    title="Supprimer"
                    className="-my-1 shrink-0 rounded-sm p-1 text-muted transition-colors hover:bg-surface-3 hover:text-status-changes"
                  >
                    <TrashIcon className="size-3" />
                  </button>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-fg-dim">
                <MentionText body={reply.body} names={reply.mentions} />
              </p>
            </li>
          ))}
        </ul>
      )}

      {replying && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendReply();
          }}
          className="mt-2 border-l border-line pl-2.5"
        >
          <textarea
            ref={replyRef}
            rows={2}
            autoFocus
            placeholder={`Répondre à ${comment.authorName}…`}
            onKeyDown={(e) => {
              if (e.key === "Escape") setReplying(false);
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                sendReply();
              }
            }}
            className="field resize-y !bg-surface"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button type="submit" disabled={pending} className="btn btn-primary !py-1">
              {pending ? "…" : "Répondre"}
            </button>
            <button
              type="button"
              onClick={() => {
                setReplying(false);
                setError(null);
              }}
              className="btn btn-ghost !py-1"
            >
              Annuler
            </button>
            <span className="meta ml-auto">Ctrl + Entrée</span>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-status-changes">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="meta">
            Supprimer
            {comment.replies.length > 0
              ? ` la note et ses ${comment.replies.length} réponses ?`
              : " ?"}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deleteCommentAction(comment.id))}
            className="btn !bg-status-changes !px-2 !py-0.5 !text-xs text-white disabled:opacity-45"
          >
            {pending ? "…" : "Oui"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn btn-ghost !px-2 !py-0.5 !text-xs"
          >
            Non
          </button>
        </div>
      ) : (
        !editing && (
          /* Pied de carte, séparé du texte par un filet : au-dessus on lit,
             en dessous on agit. Sans lui, les commandes flottaient à la
             suite de la note et se lisaient comme une ligne de plus. */
          <div className="mt-2 flex items-center gap-3 border-t border-line/60 pt-1.5">
            {/* La date a quitté l'en-tête, où elle prenait plus de place que
                le timecode. Ici elle est à sa valeur : une signature, pas
                une information de review. Forme longue en infobulle. */}
            <span
              className="meta shrink-0"
              title={formatDateTime(comment.createdAt)}
            >
              {formatShortDateTime(comment.createdAt)}
            </span>

            {/* Résoudre est ouvert à toute l'équipe : c'est souvent le
                monteur qui applique la note, pas celui qui l'a écrite. */}
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => toggleCommentResolvedAction(comment.id, !comment.resolved))
              }
              /* `-my-1 py-1` : la cible passe de 15 à 23 px de haut sans
                 rien déplacer, le libellé est trop fin pour être visé
                 confortablement à sa hauteur de texte. */
              className="card-action -my-1 shrink-0 py-1 disabled:opacity-45"
            >
              {comment.resolved ? "Rouvrir" : "Résoudre"}
            </button>

            {!replying && (
              <button
                type="button"
                onClick={() => setReplying(true)}
                className="card-action -my-1 shrink-0 py-1"
              >
                Répondre
                {comment.replies.length > 0 && (
                  <span className="ml-1 rounded-sm bg-surface-3 px-1 font-mono text-[11px] text-fg-dim">
                    {comment.replies.length}
                  </span>
                )}
              </button>
            )}

            {mine && (
              <div className="ml-auto flex gap-0.5">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="Modifier le commentaire"
                  title="Modifier"
                  className="rounded-sm p-1 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
                >
                  <PencilIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  aria-label="Supprimer le commentaire"
                  title="Supprimer"
                  className="rounded-sm p-1 text-muted transition-colors hover:bg-surface-3 hover:text-status-changes"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        )
      )}
    </li>
  );
}

/**
 * Le texte d'une note, avec ses `@Prénom` mis en avant. Les noms reconnus
 * viennent du serveur : seuls ceux d'un vrai compte sont teintés, un `@`
 * quelconque reste du texte.
 */
function MentionText({ body, names }: { body: string; names: string[] }) {
  if (names.length === 0) return body;
  return splitMentions(body, names).map((part, i) =>
    part.mention ? (
      <span key={i} className="rounded-sm bg-accent/12 px-0.5 font-medium text-accent">
        {part.text}
      </span>
    ) : (
      part.text
    ),
  );
}
