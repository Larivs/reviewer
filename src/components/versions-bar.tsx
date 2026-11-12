"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { carryNotesAction } from "@/actions/comments";
import { useRouter } from "next/navigation";
import { uploadFile } from "@/lib/upload-client";
import { formatShortDateTime } from "@/lib/format";
import { toast } from "./toast";

export type VersionItem = { id: string; version: number; createdAt: number };

/**
 * La pile de versions d'un montage : v1, v2, v3.
 *
 * Chaque version est une vidéo à part entière, avec ses propres notes. C'est
 * voulu : une note « le logo arrive trop tôt » posée sur la v1 n'a pas à
 * suivre sur la v2, où le logo a justement été déplacé. On passe de l'une à
 * l'autre ici, et « Comparer » les met côte à côte pour vérifier qu'une
 * correction a bien été faite.
 */
export function VersionsBar({
  versions,
  currentId,
  canManage,
  carry,
}: {
  versions: VersionItem[];
  currentId: string;
  /** Déposer une version est un geste du studio, comme tout dépôt. */
  canManage: boolean;
  /** Notes encore ouvertes sur la version précédente, à reporter ici. */
  carry: { fromVersion: number; open: number } | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<() => void>(() => {});
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carrying, startTransition] = useTransition();

  const current = versions.find((v) => v.id === currentId);
  const others = versions.filter((v) => v.id !== currentId);
  // Par défaut on compare à la version juste avant : c'est la question
  // qu'on se pose en ouvrant une v3, « qu'est-ce qui a changé depuis la v2 ».
  const previous =
    [...others].reverse().find((v) => v.version < (current?.version ?? 0)) ?? others[0];

  function carryNotes() {
    startTransition(async () => {
      const result = await carryNotesAction(currentId);
      if (!result.ok) return toast(result.error, "error");
      toast(
        result.carried === 0
          ? "Ces notes sont déjà sur cette version"
          : `${result.carried} note${result.carried > 1 ? "s" : ""} reportée${result.carried > 1 ? "s" : ""}`,
      );
    });
  }

  async function send(file: File) {
    setError(null);
    setProgress(0);
    try {
      const video = await uploadFile(file, { versionOf: currentId }, setProgress, (abort) => {
        abortRef.current = abort;
      });
      toast("Nouvelle version déposée");
      router.push(`/v/${video.id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Échec de l'envoi.");
    } finally {
      setProgress(null);
    }
  }

  if (versions.length < 2 && !canManage) return null;

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2"
      // Même contrat que la grille : pas de rafraîchissement sous un envoi.
      data-busy={progress !== null || undefined}
    >
      <span className="label">Versions</span>

      <div className="flex overflow-hidden rounded-sm border border-line">
        {versions.map((v) => (
          <Link
            key={v.id}
            href={`/v/${v.id}`}
            aria-current={v.id === currentId ? "page" : undefined}
            title={`Déposée le ${formatShortDateTime(v.createdAt)}`}
            className={`px-2 py-1 font-mono text-xs tabular-nums transition-colors ${
              v.id === currentId
                ? "bg-accent/15 text-accent"
                : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            v{v.version}
          </Link>
        ))}
      </div>

      {previous && (
        <Link href={`/compare/${previous.id}/${currentId}`} className="btn btn-ghost !py-1">
          Comparer à la v{previous.version}
        </Link>
      )}

      {/* Proposé seulement s'il reste quelque chose à reporter : un bouton
          qui ne ferait rien n'a pas à occuper la barre. */}
      {canManage && carry && carry.open > 0 && (
        <button
          type="button"
          onClick={carryNotes}
          disabled={carrying}
          title="Recopie ici les notes non résolues de la version précédente"
          className="btn btn-ghost !py-1"
        >
          Reporter {carry.open} note{carry.open > 1 ? "s" : ""} de la v{carry.fromVersion}
        </button>
      )}

      {canManage &&
        (progress === null ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="btn btn-ghost !py-1"
          >
            Nouvelle version
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <span className="h-[3px] w-28 overflow-hidden rounded-sm bg-surface-3">
              <span
                className="block h-full bg-accent transition-[width] duration-150"
                style={{ width: `${progress * 100}%` }}
              />
            </span>
            <span className="meta">{Math.round(progress * 100)} %</span>
            <button type="button" onClick={() => abortRef.current()} className="card-action">
              Annuler
            </button>
          </span>
        ))}

      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*,audio/*,.mp4,.mov,.m4v,.webm,.mkv,.mxf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void send(file);
        }}
      />

      {error && (
        <span role="alert" className="text-xs text-status-changes">
          {error}
        </span>
      )}
    </div>
  );
}
