import Link from "next/link";
import { Logo } from "@/components/logo";
import { revokeSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Où atterrit un invité dont le lien est mort pendant qu'il l'utilisait.
 *
 * Le renvoyer vers l'écran de connexion lui présenterait un formulaire qu'il
 * ne peut pas remplir : il n'a jamais eu de mot de passe. On ferme sa
 * session au passage, sinon il resterait porteur d'un cookie qui ne donne
 * plus rien mais qui l'empêche de repasser par un nouveau lien.
 */
export default async function ExpiredPage() {
  await revokeSession();

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6">
      <div className="ambience-cool" aria-hidden />
      <div className="relative w-full max-w-[400px]">
        <div className="flex items-center gap-2.5">
          <Logo className="size-[22px] text-accent" />
          <span className="wordmark text-[13px] text-fg">Reviewer</span>
        </div>
        <div className="mt-6 rounded-lg border border-line bg-surface/85 p-6 backdrop-blur-md">
          <h1 className="heading text-[22px]">Ton accès a pris fin</h1>
          <p className="mt-2 text-sm text-muted">
            Le lien par lequel tu étais entré a expiré ou a été fermé. Tes
            commentaires, eux, sont conservés : demande un nouveau lien à la
            personne qui t&apos;avait invité et tu les retrouveras.
          </p>
          <Link href="/login" className="btn btn-ghost mt-5 !py-1.5">
            Se connecter autrement
          </Link>
        </div>
      </div>
    </main>
  );
}
