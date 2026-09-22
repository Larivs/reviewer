"use client";

import { useState, useTransition } from "react";
import { joinWithLinkAction } from "@/actions/share";

/**
 * La seule chose qu'on demande au client : son prénom.
 *
 * Pas pour l'identifier, le lien s'en charge, mais pour signer ses notes.
 * Une review à trois voix dont les notes n'ont pas d'auteur devient
 * illisible dès la deuxième contradiction.
 */
export function JoinForm({ token, target }: { token: string; target: string | null }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim() || pending) return;
    startTransition(async () => {
      // Une entrée réussie redirige côté serveur : on ne revient ici que
      // si quelque chose a échoué.
      const result = await joinWithLinkAction(token, name);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <label htmlFor="prenom" className="label block !text-[12px]">
          Ton prénom
        </label>
        <input
          id="prenom"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          autoFocus
          autoComplete="given-name"
          placeholder="Marie"
          className="field !py-2.5 !text-[15px]"
        />
        <p className="text-xs text-muted">
          Il servira à signer tes commentaires. Aucun mot de passe à créer.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-sm border border-status-changes/40 bg-status-changes/10 px-3 py-2.5 text-sm text-status-changes"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="btn btn-primary mt-1 w-full !py-3 !text-[15px]"
      >
        {pending ? "Ouverture…" : target ? `Ouvrir ${target}` : "Entrer"}
      </button>
    </form>
  );
}
