"use client";

import { useState, useTransition } from "react";
import {
  countAccountNotesAction,
  createAccountAction,
  deleteAccountAction,
  resetAccountPasswordAction,
  setAccountGrantsAction,
  setAccountRoleAction,
  type PasswordResult,
} from "@/actions/accounts";
import type { Account } from "@/lib/access";
import type { FolderOption } from "@/lib/folders";
import type { UserRole } from "@/db/schema";
import { formatShortDateTime } from "@/lib/format";
import { UserChip } from "./user-chip";
import { TrashIcon } from "./icons";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  membre: "Membre",
  invite: "Invité",
};

const ROLE_HELP: Record<UserRole, string> = {
  admin: "Voit tout, et gère les comptes.",
  membre: "Voit tout, dépose et commente. Pour le studio.",
  invite: "Ne voit que les projets cochés. Commente et résout.",
};

/**
 * Le mot de passe ne s'affiche qu'une fois et ne revient jamais : c'est la
 * seule façon de garantir qu'il n'existe en clair nulle part. Le cartouche
 * est donc insistant, et il faut le refermer à la main.
 */
function PasswordCard({
  result,
  onClose,
}: {
  result: { name: string; password: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-3 rounded-lg border border-accent-dim bg-accent/[0.07] p-3">
      <p className="text-sm text-fg">
        Mot de passe de <strong>{result.name}</strong>, transmets-le
        maintenant, il ne sera plus affiché.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="select-all rounded-sm border border-line bg-surface-3 px-2 py-1 font-mono text-[15px] tracking-[0.08em] text-accent">
          {result.password}
        </code>
        <button
          type="button"
          onClick={() => {
            // Le presse-papier peut être refusé (page non sécurisée, réglage
            // du navigateur) : le code reste sélectionnable à la main, donc
            // un échec n'est pas bloquant et ne mérite pas d'alerte.
            navigator.clipboard
              ?.writeText(result.password)
              .then(() => setCopied(true))
              .catch(() => {});
          }}
          className="btn btn-ghost !py-1"
        >
          {copied ? "Copié" : "Copier"}
        </button>
        <button type="button" onClick={onClose} className="card-action ml-auto">
          Fermer
        </button>
      </div>
    </div>
  );
}

function ProjectPicker({
  projects,
  selected,
  onToggle,
}: {
  projects: FolderOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (projects.length === 0)
    return (
      <p className="mt-1.5 text-xs text-muted">
        Aucun projet pour l&apos;instant. Crée un dossier, puis reviens cocher.
      </p>
    );

  return (
    <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto rounded-sm border border-line bg-surface p-2">
      {projects.map((p) => (
        <label
          key={p.id}
          className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-[13px] text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <input
            type="checkbox"
            checked={selected.has(p.id)}
            onChange={() => onToggle(p.id)}
            className="accent-[var(--color-accent)]"
          />
          <span className="truncate">{p.label}</span>
        </label>
      ))}
    </div>
  );
}

function NewAccount({ projects }: { projects: FolderOption[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("invite");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (!name.trim() || pending) return;
    startTransition(async () => {
      const result: PasswordResult = await createAccountAction({
        name,
        role,
        folderIds: [...picked],
      });
      if (result.ok) {
        setCreated({ name: result.name, password: result.password });
        setName("");
        setPicked(new Set());
        setError(null);
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="heading heading-sm text-[15px]">Ouvrir un compte</h2>
          <p className="mt-0.5 text-xs text-muted">
            L&apos;app tire le mot de passe, tu le transmets. Tu ne le connais
            pas à l&apos;avance et il ne se relit pas.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn btn-primary !py-1 shrink-0"
          >
            Nouveau compte
          </button>
        )}
      </div>

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-3 grid gap-3 sm:grid-cols-2"
        >
          <div>
            <label className="label" htmlFor="nouveau-nom">
              Nom
            </label>
            <input
              id="nouveau-nom"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              autoFocus
              placeholder="Jérôme"
              className="field mt-1.5"
            />

            <div className="mt-3">
              <span className="label">Rôle</span>
              <div className="mt-1.5 space-y-1">
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                  <label
                    key={r}
                    className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1 transition-colors hover:bg-surface-2"
                  >
                    <input
                      type="radio"
                      name="role"
                      checked={role === r}
                      onChange={() => setRole(r)}
                      className="mt-0.5 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-fg">
                        {ROLE_LABELS[r]}
                      </span>
                      <span className="block text-xs text-muted">{ROLE_HELP[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div>
            {/* Le choix des projets ne s'affiche que pour un invité : c'est le
                seul rôle dont la portée se découpe. Le montrer grisé pour les
                autres laisserait croire qu'on peut restreindre un membre. */}
            {role === "invite" ? (
              <>
                <span className="label">Projets ouverts</span>
                <ProjectPicker projects={projects} selected={picked} onToggle={toggle} />
                {picked.size === 0 && (
                  <p className="mt-1.5 text-xs text-status-doing">
                    Sans projet coché, ce compte se connectera sur un espace vide.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted">
                Ce rôle voit tout l&apos;espace : il n&apos;y a pas de projets à
                choisir.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs text-status-changes sm:col-span-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={pending || !name.trim()}
              className="btn btn-primary !py-1"
            >
              {pending ? "…" : "Créer le compte"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="btn btn-ghost !py-1"
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      {created && <PasswordCard result={created} onClose={() => setCreated(null)} />}
    </section>
  );
}

function AccountRow({
  account,
  index,
  projects,
  isMe,
}: {
  account: Account;
  index: number;
  projects: FolderOption[];
  isMe: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(account.grants.map((g) => g.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<{ name: string; password: string } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        done?.();
      } else {
        setError(result.error ?? "Action impossible.");
      }
    });
  }

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <li className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <UserChip name={account.name} colorIndex={index} withName size="md" shrink={false} />

        <select
          value={account.role}
          disabled={pending || isMe}
          onChange={(e) => run(() => setAccountRoleAction(account.id, e.target.value))}
          aria-label={`Rôle de ${account.name}`}
          title={isMe ? "On ne change pas son propre rôle" : ROLE_HELP[account.role]}
          className="rounded-sm border border-line bg-surface-3 px-1.5 py-1 text-[11px] text-fg-dim disabled:opacity-45"
        >
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>

        {account.role === "invite" && (
          <span className="meta">
            {account.grants.length === 0
              ? "aucun projet"
              : `${account.grants.length} projet${account.grants.length > 1 ? "s" : ""}`}
          </span>
        )}

        <span className="meta ml-auto shrink-0">{formatShortDateTime(account.createdAt)}</span>

        {account.role === "invite" && (
          <button
            type="button"
            onClick={() => {
              // Repartir des droits réels : un changement de rôle les a
              // peut-être vidés, et d'anciennes coches laissaient croire
              // à un accès qui n'existait plus.
              if (!editing) setPicked(new Set(account.grants.map((g) => g.id)));
              setEditing((v) => !v);
            }}
            className="card-action shrink-0"
          >
            {editing ? "Fermer" : "Projets"}
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await resetAccountPasswordAction(account.id);
              if (result.ok) setReset({ name: result.name, password: result.password });
              else setError(result.error);
            })
          }
          className="card-action shrink-0"
        >
          Nouveau mot de passe
        </button>

        {!isMe && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                // On va chercher le nombre de notes avant de demander : « tu
                // es sûr ? » sans dire ce qu'on perd n'est pas une question.
                setConfirming(await countAccountNotesAction(account.id));
              })
            }
            aria-label={`Supprimer ${account.name}`}
            title="Supprimer ce compte"
            className="shrink-0 rounded-sm p-1 text-muted transition-colors hover:bg-surface-3 hover:text-status-changes"
          >
            <TrashIcon className="size-3.5" />
          </button>
        )}
      </div>

      {account.role === "invite" && !editing && account.grants.length > 0 && (
        <p className="mt-2 text-xs text-fg-dim">
          {account.grants.map((g) => g.name).join(" · ")}
        </p>
      )}

      {editing && (
        <div className="mt-2">
          <ProjectPicker projects={projects} selected={picked} onToggle={toggle} />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => setAccountGrantsAction(account.id, [...picked]),
                  () => setEditing(false),
                )
              }
              className="btn btn-primary !py-1"
            >
              {pending ? "…" : "Enregistrer"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPicked(new Set(account.grants.map((g) => g.id)));
                setEditing(false);
              }}
              className="btn btn-ghost !py-1"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {confirming !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-status-changes/40 bg-status-changes/[0.07] p-2">
          <span className="text-xs text-fg">
            Supprimer <strong>{account.name}</strong>
            {confirming > 0
              ? ` et ses ${confirming} note${confirming > 1 ? "s" : ""} de review ?`
              : " ? Il n'a écrit aucune note."}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deleteAccountAction(account.id))}
            className="btn !bg-status-changes !px-2 !py-0.5 !text-[11px] text-white disabled:opacity-45"
          >
            {pending ? "…" : "Oui"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(null)}
            className="btn btn-ghost !px-2 !py-0.5 !text-[11px]"
          >
            Non
          </button>
        </div>
      )}

      {reset && <PasswordCard result={reset} onClose={() => setReset(null)} />}

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-status-changes">
          {error}
        </p>
      )}
    </li>
  );
}

export function AccountsPanel({
  accounts,
  projects,
  currentUserId,
}: {
  accounts: Account[];
  projects: FolderOption[];
  currentUserId: string;
}) {
  return (
    <div className="space-y-4">
      <NewAccount projects={projects} />

      <section>
        <div className="mb-3 flex items-center gap-2.5">
          <h2 className="label !text-fg-dim">Comptes</h2>
          <span className="rounded-sm bg-surface-2 px-1.5 py-px font-mono text-[10px] tabular-nums text-muted">
            {accounts.length}
          </span>
          <span aria-hidden className="h-px flex-1 bg-line" />
        </div>

        <ul className="space-y-2">
          {accounts.map((account, i) => (
            <AccountRow
              key={account.id}
              account={account}
              /* Le rang de couleur est celui de l'ancienneté du compte, le
                 même que partout ailleurs : la pastille d'ici doit être celle
                 qu'on voit sur les notes. */
              index={i}
              projects={projects}
              isMe={account.id === currentUserId}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
