"use client";

import { useState, useTransition } from "react";
import { deleteShareLinkAction } from "@/actions/share";
import type { LinkRow } from "@/lib/share";
import { formatShortDateTime } from "@/lib/format";
import { TrashIcon } from "./icons";

/**
 * Les liens ouverts, et de quoi les refermer.
 *
 * Fermer un lien ne supprime pas les comptes qu'il a créés ni leurs notes :
 * effacer la review d'un client parce qu'on révoque un accès serait une
 * perte de travail, pas une mesure de sécurité. Les personnes entrées par ce
 * lien perdent leurs droits et leur session, ce qu'elles ont écrit reste.
 */
export function ShareLinksPanel({ links }: { links: LinkRow[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <h2 className="label !text-fg-dim">Liens de review</h2>
        <span className="rounded-sm bg-surface-2 px-1.5 py-px font-mono text-[10px] tabular-nums text-muted">
          {links.length}
        </span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted">
          Aucun lien ouvert. Le bouton « Partager » est sur une vidéo ou sur un
          projet.
        </p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <LinkRowItem key={link.id} link={link} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LinkRowItem({ link }: { link: LinkRow }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const expired = link.expiresAt !== null && link.expiresAt <= Date.now();

  return (
    <li className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="label shrink-0">
          {link.kind === "video" ? "Vidéo" : "Projet"}
        </span>

        <span className="min-w-0 truncate text-sm font-medium text-fg">
          {/* La cible a pu être supprimée depuis : le lien ne mène alors plus
              nulle part, autant le dire plutôt que d'afficher un vide. */}
          {link.target ?? "(supprimé)"}
        </span>

        {expired ? (
          <span className="shrink-0 rounded-sm border border-line px-1.5 py-px text-[10.5px] text-muted">
            expiré
          </span>
        ) : (
          <span className="meta shrink-0">
            {link.expiresAt === null
              ? "sans expiration"
              : `expire le ${formatShortDateTime(link.expiresAt)}`}
          </span>
        )}

        <span className="meta shrink-0">
          {link.visitors === 0
            ? "personne encore"
            : `${link.visitors} personne${link.visitors > 1 ? "s" : ""}`}
        </span>

        <button
          type="button"
          onClick={() => {
            const url = `${window.location.origin}/r/${link.token}`;
            // Le presse-papiers n'existe qu'en HTTPS ou sur localhost : sur
            // l'adresse du réseau local le bouton ne faisait rien, sans le
            // dire. On montre alors l'adresse, à copier à la main.
            const fallback = () => window.prompt("Copie ce lien :", url);
            if (!navigator.clipboard) return void fallback();
            navigator.clipboard.writeText(url).then(() => setCopied(true), fallback);
          }}
          className="card-action ml-auto shrink-0"
        >
          {copied ? "Copié" : "Copier le lien"}
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          aria-label="Fermer ce lien"
          title="Fermer ce lien"
          className="shrink-0 rounded-sm p-1 text-muted transition-colors hover:bg-surface-3 hover:text-status-changes"
        >
          <TrashIcon className="size-3.5" />
        </button>
      </div>

      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-status-changes/40 bg-status-changes/[0.07] p-2">
          <span className="text-xs text-fg">
            Fermer ce lien ?
            {link.visitors > 0
              ? ` ${link.visitors} personne${link.visitors > 1 ? "s perdront" : " perdra"} l'accès. Leurs notes restent.`
              : " Personne ne l'a encore utilisé."}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteShareLinkAction(link.id);
                if (!result.ok) setError(result.error ?? "Action impossible.");
              })
            }
            className="btn !bg-status-changes !px-2 !py-0.5 !text-[11px] text-white disabled:opacity-45"
          >
            {pending ? "…" : "Oui"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn btn-ghost !px-2 !py-0.5 !text-[11px]"
          >
            Non
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-status-changes">
          {error}
        </p>
      )}
    </li>
  );
}
