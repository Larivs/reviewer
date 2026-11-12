"use client";

import { useEffect, useRef, useState } from "react";

/** Durée de l'appui. Assez pour ne pas partir d'un clic, pas assez pour agacer. */
const HOLD_MS = 900;

/**
 * Bouton à maintenir, pour ce qui ne se rattrape pas.
 *
 * Supprimer un dossier emporte son sous-arbre, ses fichiers et les notes de
 * tout le monde. Le panneau de confirmation l'annonce, mais son bouton restait
 * un clic, et un double-clic nerveux sur la corbeille validait dans la foulée.
 * Ici le geste demande une intention : on appuie, le bouton se remplit, on
 * peut relâcher pour renoncer.
 *
 * Au clavier, Entrée ou Espace maintenus font la même chose.
 */
export function HoldButton({
  onConfirm,
  disabled = false,
  children,
  className = "",
}: {
  onConfirm: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;

  function start() {
    if (disabled || holding) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      confirm.current();
    }, HOLD_MS);
  }

  function cancel() {
    window.clearTimeout(timer.current);
    setHolding(false);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const isHoldKey = (key: string) => key === "Enter" || key === " ";

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => e.button === 0 && start()}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (!isHoldKey(e.key)) return;
        e.preventDefault();
        // La répétition automatique renvoie `keydown` en rafale : on ne
        // démarre qu'au premier.
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => isHoldKey(e.key) && cancel()}
      onBlur={cancel}
      // Le navigateur ne doit pas prendre l'appui long pour un menu ou un
      // défilement sur écran tactile.
      onContextMenu={(e) => e.preventDefault()}
      title="Maintiens le bouton enfoncé"
      className={`btn relative touch-none select-none overflow-hidden border border-status-changes/60 !py-1 text-status-changes disabled:opacity-45 ${className}`}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-status-changes"
        style={{
          width: holding ? "100%" : "0%",
          // Remplissage sur la durée de l'appui, retour immédiat au relâché.
          transition: holding ? `width ${HOLD_MS}ms linear` : "width 120ms ease-out",
        }}
      />
      <span className={`relative transition-colors ${holding ? "text-white" : ""}`}>
        {children}
      </span>
    </button>
  );
}
