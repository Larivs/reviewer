import Link from "next/link";
import { logout } from "@/app/login/actions";
import { AUTH_DISABLED } from "@/lib/config";
import { isAdmin, type Viewer } from "@/lib/access";
import { userColorIndex } from "@/lib/users";
import { Logo } from "./logo";
import { UserChip } from "./user-chip";
import { TourButton } from "./tour/tour-button";
import { CommandPalette } from "./command-palette";

export function AppHeader({ user }: { user: Viewer }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-sm">
      <div className="mx-auto flex h-13 max-w-[1600px] items-center gap-4 px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <Logo className="size-[18px] text-accent transition-transform group-hover:scale-110" />
          <span className="wordmark text-[14px] text-fg">
            Reviewer
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-4">
          {AUTH_DISABLED && (
            <span
              title="AUTH_DISABLED=1 dans .env.local"
              className="label !text-status-doing"
            >
              Auth désactivée
            </span>
          )}

          {/* Visible des seuls administrateurs : la page rend un 404 aux
              autres, autant ne pas leur montrer une porte fermee. */}
          {isAdmin(user) && (
            <Link href="/admin" className="label transition-colors hover:!text-fg">
              Comptes
            </Link>
          )}

          <CommandPalette isAdmin={isAdmin(user)} />

          <TourButton />

          {/* Sa propre couleur, présente dès l'en-tête : c'est elle qu'on
              retrouve ensuite sur ses notes, ses repères et ses dessins. */}
          <UserChip name={user.name} colorIndex={userColorIndex(user.id)} withName />

          {!AUTH_DISABLED && (
            <form action={logout}>
              <button type="submit" className="label transition-colors hover:!text-fg">
                Déconnexion
              </button>
            </form>
          )}
        </div>
      </div>

    </header>
  );
}
