"use client";

import type { Annotation } from "@/lib/annotation";
import type { Tool } from "./annotation-layer";

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const TOOLS: { id: Exclude<Tool, "none">; label: string; icon: React.ReactNode }[] = [
  {
    id: "pin",
    label: "Point",
    icon: (
      <>
        <circle cx="12" cy="12" r="7" {...S} />
        <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      </>
    ),
  },
  {
    id: "arrow",
    label: "Flèche",
    icon: (
      <>
        <path d="M5 19L19 5" {...S} />
        <path d="M12 5h7v7" {...S} />
      </>
    ),
  },
  {
    id: "rect",
    label: "Cadre",
    icon: <rect x="4.5" y="6.5" width="15" height="11" rx="1.5" {...S} />,
  },
  {
    id: "free",
    label: "Tracé libre",
    icon: <path d="M4 15c3-7 5 3 8-2s3 4 8 1" {...S} />,
  },
];

type Props = {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  draft: Annotation | null;
  onDraftChange: (annotation: Annotation | null) => void;
};

export function AnnotationToolbar({
  tool,
  onToolChange,
  draft,
  onDraftChange,
}: Props) {
  const count = draft?.shapes.length ?? 0;

  function undo() {
    if (!draft || count === 0) return;
    const shapes = draft.shapes.slice(0, -1);
    onDraftChange(shapes.length > 0 ? { shapes } : null);
  }

  return (
    <div className="absolute left-3 top-3 flex items-center gap-1 rounded-md border border-line-strong/70 bg-bg/85 p-1 backdrop-blur-sm">
      {TOOLS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onToolChange(entry.id)}
          aria-pressed={tool === entry.id}
          title={entry.label}
          aria-label={entry.label}
          className={`rounded-sm p-1.5 transition-colors ${
            tool === entry.id
              ? "bg-accent text-accent-fg"
              : "text-fg-dim hover:bg-surface-3 hover:text-fg"
          }`}
        >
          <svg viewBox="0 0 24 24" className="size-4">
            {entry.icon}
          </svg>
        </button>
      ))}

      <span aria-hidden className="mx-0.5 h-5 w-px bg-line-strong/60" />

      <button
        type="button"
        onClick={undo}
        disabled={count === 0}
        title="Annuler la dernière forme"
        className="label px-1.5 py-1 transition-colors hover:!text-fg disabled:opacity-40"
      >
        Annuler
      </button>
      <button
        type="button"
        onClick={() => onDraftChange(null)}
        disabled={count === 0}
        title="Tout effacer"
        className="label px-1.5 py-1 transition-colors hover:!text-status-changes disabled:opacity-40"
      >
        Effacer
      </button>

      <span aria-hidden className="mx-0.5 h-5 w-px bg-line-strong/60" />

      {/* Sortir des outils rend le clic sur l'image au lecteur. */}
      <button
        type="button"
        onClick={() => onToolChange("none")}
        title="Quitter le mode annotation"
        className="label px-1.5 py-1 transition-colors hover:!text-fg"
      >
        Terminer
      </button>
    </div>
  );
}
