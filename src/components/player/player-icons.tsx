type IconProps = { className?: string };

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" />
    </svg>
  );
}

/** Une image en arrière / en avant : barre + triangle. */
export function StepIcon({ className, back }: IconProps & { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <g transform={back ? "translate(24,0) scale(-1,1)" : undefined} fill="currentColor">
        <path d="M7 6v12l9-6-9-6Z" />
        <rect x="17" y="6" width="2" height="12" rx="1" />
      </g>
    </svg>
  );
}

export function LoopIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M7 7h10a3 3 0 0 1 3 3v1M17 17H7a3 3 0 0 1-3-3v-1" {...S} />
      <path d="M17.5 4.5L20 7l-2.5 2.5M6.5 19.5L4 17l2.5-2.5" {...S} />
    </svg>
  );
}

export function VolumeIcon({ className, muted }: IconProps & { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M4 9.5h3L11 6v12l-4-3.5H4v-5Z" fill="currentColor" />
      {muted ? (
        <path d="M15 9.5l4.5 5m0-5l-4.5 5" {...S} />
      ) : (
        <path d="M14.5 9a4 4 0 0 1 0 6M17 7a7 7 0 0 1 0 10" {...S} />
      )}
    </svg>
  );
}

export function ZoomIcon({ className, out }: IconProps & { out?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <circle cx="11" cy="11" r="6.5" {...S} />
      <path d="M16 16l4.5 4.5" {...S} />
      <path d={out ? "M8 11h6" : "M8 11h6M11 8v6"} {...S} />
    </svg>
  );
}

export function FullscreenIcon({ className, exit }: IconProps & { exit?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      {exit ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" {...S} />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" {...S} />
      )}
    </svg>
  );
}
