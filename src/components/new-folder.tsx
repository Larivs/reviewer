"use client";

import { useRef, useState, useTransition } from "react";
import { createFolderAction } from "@/actions/folders";

export function NewFolder({ parentId }: { parentId: string | null }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = inputRef.current;
    if (!input) return;

    startTransition(async () => {
      const result = await createFolderAction(parentId, input.value);
      if (result.ok) {
        input.value = "";
        setError(null);
        // On garde le champ ouvert : créer plusieurs dossiers d'affilée est
        // le cas courant en début de projet.
        input.focus();
      } else {
        setError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost !py-1.5">
        Nouveau dossier
      </button>
    );
  }

  return (
    // `data-busy` : voir `live-grid`. Un champ ouvert ne doit pas être
    // rafraîchi sous les doigts.
    <form data-busy onSubmit={submit} className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          name="name"
          className="field !w-56 !py-1.5"
          placeholder="Nom du dossier"
          autoFocus
          onKeyDown={(e) => e.key === "Escape" && close()}
        />
        <button type="submit" className="btn btn-primary !py-1.5" disabled={pending}>
          {pending ? "…" : "Créer"}
        </button>
        <button type="button" onClick={close} className="btn btn-ghost !py-1.5">
          Fermer
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-status-changes">
          {error}
        </p>
      )}
    </form>
  );
}
