const SHORTCUTS: [string, string][] = [
  ["Espace / K", "Lecture ou pause"],
  ["← / →", "Une image en arrière ou en avant"],
  ["Maj + ← / →", "Une seconde en arrière ou en avant"],
  [", / .", "Une image (convention des logiciels de montage)"],
  ["J / L", "Navette arrière ou avant, chaque appui double la vitesse"],
  ["I / O / X", "Poser l'entrée ou la sortie de boucle, les retirer"],
  ["0 - 9", "Aller à 0 %, 10 %… de la vidéo"],
  ["Début / Fin", "Aller au début ou à la fin"],
  ["M", "Couper ou rétablir le son"],
  ["R", "Lecture en boucle ; un clic sur une note boucle jusqu'à la suivante"],
  ["Ctrl + molette", "Zoomer dans l'image, puis glisser pour recadrer"],
  ["Alt + clic sur la piste", "Viser au pixel, sans aimantation aux notes"],
  ["F", "Plein écran"],
];

export function ShortcutsHelp() {
  return (
    <details
      data-tour="shortcuts"
      className="mt-2.5 rounded-lg border border-line bg-surface px-3.5 py-2.5"
    >
      <summary className="label cursor-pointer transition-colors hover:!text-fg">
        Raccourcis clavier
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={keys} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 rounded-sm border border-line bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-fg-dim">
              {keys}
            </dt>
            <dd className="text-right text-xs text-muted">{label}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
