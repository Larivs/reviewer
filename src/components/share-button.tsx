"use client";

import { useState, useTransition } from "react";
import { createShareLinkAction } from "@/actions/share";
import { LINK_DURATIONS, type LinkDuration, type ShareTarget } from "@/lib/share-types";

/**
 * « Partager » : la façon dont un client entre dans la review.
 *
 * Le geste tient en trois clics — ouvrir, choisir une durée, copier — parce
 * que c'est le geste qu'on fait vingt fois par semaine. Le lien apparaît en
 * clair et reste sélectionnable : un bouton « copier » qui échoue en
 * silence, sur une page non sécurisée, laisserait l'utilisateur croire qu'il
 * a le lien dans son presse-papier.
 */
export function ShareButton({
  target,
  label,
}: {
  target: ShareTarget;
  /** Ce qu'on partage, pour le dire dans le panneau. */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<LinkDuration>("30");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      const result = await createShareLinkAction(target, duration);
      if (result.ok) {
        // L'origine vient du navigateur : c'est la seule façon d'obtenir
        // l'adresse par laquelle on accède réellement au serveur — nom de
        // machine sur le réseau local, adresse Tailscale ou nom de domaine.
        setLink(`${window.location.origin}/r/${result.token}`);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setLink(null);
          setCopied(false);
        }}
        aria-expanded={open}
        className="btn btn-ghost !py-1"
      >
        Partager
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[330px] rounded-lg border border-line bg-surface p-3 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]">
          <p className="text-sm text-fg">
            Lien de review pour <strong>{label}</strong>
          </p>
          <p className="mt-1 text-xs text-muted">
            Qui a le lien entre, donne son prénom et commente. Aucun compte à
            créer de ton côté.
          </p>

          {!link ? (
            <>
              <div className="mt-3">
                <label htmlFor="duree" className="label block">
                  Expire au bout de
                </label>
                <select
                  id="duree"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value as LinkDuration)}
                  className="field mt-1.5 !py-1.5 !text-[13px]"
                >
                  {LINK_DURATIONS.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <p role="alert" className="mt-2 text-xs text-status-changes">
                  {error}
                </p>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={create}
                  disabled={pending}
                  className="btn btn-primary !py-1"
                >
                  {pending ? "…" : "Créer le lien"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="btn btn-ghost !py-1"
                >
                  Annuler
                </button>
              </div>
            </>
          ) : (
            <>
              <code className="mt-3 block select-all break-all rounded-sm border border-line bg-surface-3 px-2 py-1.5 font-mono text-[11px] text-accent">
                {link}
              </code>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(link)
                      .then(() => setCopied(true))
                      .catch(() => {});
                  }}
                  className="btn btn-primary !py-1"
                >
                  {copied ? "Copié" : "Copier"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLink(null);
                    setCopied(false);
                  }}
                  className="card-action"
                >
                  Un autre
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="card-action ml-auto"
                >
                  Fermer
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                Révocable à tout moment depuis la page Comptes.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
