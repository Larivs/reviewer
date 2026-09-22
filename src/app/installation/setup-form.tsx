"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setupAdminAction } from "@/actions/share";

export function SetupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (pending) return;
    startTransition(async () => {
      const result = await setupAdminAction(name, password);
      if (result.ok) router.push("/");
      else setError(result.error);
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
        <label htmlFor="admin-nom" className="label block !text-[12px]">
          Ton nom
        </label>
        <input
          id="admin-nom"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          autoFocus
          autoComplete="username"
          className="field !py-2.5 !text-[15px]"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="admin-mdp" className="label block !text-[12px]">
          Mot de passe
        </label>
        <input
          id="admin-mdp"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          autoComplete="new-password"
          className="field !py-2.5 !text-[15px]"
        />
        <p className="text-xs text-muted">
          Huit caractères minimum. C&apos;est le seul mot de passe que tu
          choisiras toi-même : ceux des comptes que tu ouvriras ensuite sont
          tirés par l&apos;app.
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
        disabled={pending || !name.trim() || password.length < 8}
        className="btn btn-primary mt-1 w-full !py-3 !text-[15px]"
      >
        {pending ? "Création…" : "Créer mon espace"}
      </button>
    </form>
  );
}
