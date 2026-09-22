"use client";

import { useRef, useState } from "react";
import type { Annotation, Shape } from "@/lib/annotation";
import { usePictureRect } from "../player/use-picture-rect";
import { capturePointer, releasePointer } from "@/lib/pointer";

export type Tool = "none" | "pin" | "arrow" | "rect" | "free";

/** Distance minimale entre deux points d'un tracé libre, en fraction. */
const FREE_STEP = 0.004;

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  tool: Tool;
  /** Annotation en cours de dessin, pilotée par le parent. */
  draft: Annotation | null;
  onDraftChange: (annotation: Annotation | null) => void;
  /** Annotation d'une note existante, affichée en lecture seule. */
  shown?: Annotation | null;
  /**
   * Teinte des tracés : celle de l'auteur de l'annotation affichée, ou la
   * sienne pendant qu'on dessine. Deux flèches sur la même image ne disent
   * pas la même chose selon qui les a posées — la couleur le dit sans
   * qu'on ait à ouvrir la note.
   */
  color?: string;
};

/**
 * Chaque forme est tracée deux fois : un halo sombre dessous, le tracé
 * coloré dessus. Sans ça, un trait clair sur un plan clair disparaît.
 */
function ShapeMarks({
  shape,
  w,
  h,
  halo,
  color,
}: {
  shape: Shape;
  w: number;
  h: number;
  halo: boolean;
  color: string;
}) {
  const stroke = halo ? "rgba(0,0,0,0.55)" : color;
  const width = halo ? 5 : 2;
  const common = {
    stroke,
    strokeWidth: width,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  switch (shape.t) {
    case "pin":
      return (
        <g>
          <circle cx={shape.x * w} cy={shape.y * h} r={11} {...common} />
          <circle
            cx={shape.x * w}
            cy={shape.y * h}
            r={halo ? 3.5 : 2.5}
            fill={stroke}
            stroke="none"
          />
        </g>
      );

    case "rect":
      return (
        <rect
          x={shape.x * w}
          y={shape.y * h}
          width={shape.w * w}
          height={shape.h * h}
          rx={2}
          {...common}
        />
      );

    case "arrow": {
      const x1 = shape.x1 * w;
      const y1 = shape.y1 * h;
      const x2 = shape.x2 * w;
      const y2 = shape.y2 * h;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = 13;
      const spread = 0.42;
      return (
        <g>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
          <path
            d={`M${x2 - head * Math.cos(angle - spread)} ${y2 - head * Math.sin(angle - spread)} L${x2} ${y2} L${x2 - head * Math.cos(angle + spread)} ${y2 - head * Math.sin(angle + spread)}`}
            {...common}
          />
        </g>
      );
    }

    case "free":
      return (
        <polyline
          points={shape.pts.map(([x, y]) => `${x * w},${y * h}`).join(" ")}
          {...common}
        />
      );
  }
}

export function AnnotationLayer({
  videoRef,
  tool,
  draft,
  onDraftChange,
  shown,
  color = "var(--color-accent)",
}: Props) {
  const rect = usePictureRect(videoRef);
  const [pending, setPending] = useState<Shape | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const active = tool !== "none";
  const visible = draft ?? shown ?? null;

  if (!rect) return null;

  function toFraction(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }

  function addShape(shape: Shape) {
    const shapes = [...(draft?.shapes ?? []), shape];
    onDraftChange({ shapes });
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!active) return;
    event.preventDefault();
    capturePointer(event.currentTarget, event.pointerId);
    const p = toFraction(event);

    if (tool === "pin") {
      addShape({ t: "pin", ...p });
      return;
    }

    startRef.current = p;
    if (tool === "free") setPending({ t: "free", pts: [[p.x, p.y]] });
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!active || !startRef.current) return;
    const p = toFraction(event);
    const s = startRef.current;

    if (tool === "arrow") {
      setPending({ t: "arrow", x1: s.x, y1: s.y, x2: p.x, y2: p.y });
    } else if (tool === "rect") {
      setPending({
        t: "rect",
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x),
        h: Math.abs(p.y - s.y),
      });
    } else if (tool === "free") {
      setPending((current) => {
        if (!current || current.t !== "free") return current;
        const last = current.pts[current.pts.length - 1];
        // On échantillonne : un point par pixel saturerait le tracé.
        if (Math.hypot(p.x - last[0], p.y - last[1]) < FREE_STEP) return current;
        return { t: "free", pts: [...current.pts, [p.x, p.y]] };
      });
    }
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    releasePointer(event.currentTarget, event.pointerId);
    startRef.current = null;
    if (pending) addShape(pending);
    setPending(null);
  }

  const shapes = [...(visible?.shapes ?? []), ...(pending ? [pending] : [])];

  return (
    <svg
      width={rect.width}
      height={rect.height}
      viewBox={`0 0 ${rect.width} ${rect.height}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`absolute ${active ? "cursor-crosshair" : "pointer-events-none"}`}
      style={{ left: rect.left, top: rect.top }}
      aria-hidden={!active}
    >
      {/* Halos d'abord, tracés ensuite : tout le dessin reste lisible sur
          un plan clair comme sur un plan sombre. */}
      {shapes.map((shape, i) => (
        <ShapeMarks
          key={`h${i}`}
          shape={shape}
          w={rect.width}
          h={rect.height}
          halo
          color={color}
        />
      ))}
      {shapes.map((shape, i) => (
        <ShapeMarks
          key={`s${i}`}
          shape={shape}
          w={rect.width}
          h={rect.height}
          halo={false}
          color={color}
        />
      ))}
    </svg>
  );
}
