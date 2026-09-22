import Link from "next/link";
import { Logo } from "@/components/logo";

/**
 * Page atteinte quand un dossier ou une vidéo n'existe plus — un lien
 * partagé après une suppression, typiquement. Jusqu'ici c'était l'écran
 * brut de Next, sans retour vers l'app.
 */
export default function NotFound() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6">
      <div
        aria-hidden
        className="absolute inset-0 bg-[url('/bg/faisceau.jpg')] bg-cover bg-center"
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(70% 60% at 50% 50%, rgba(11,13,12,0.35) 0%, rgba(11,13,12,0.88) 100%)",
        }}
      />

      <div className="relative max-w-md text-center">
        <div className="flex items-center justify-center gap-2.5">
          <Logo className="size-5 text-accent" />
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-fg-dim">
            Reviewer
          </span>
        </div>

        <p className="label mt-8">Hors bobine</p>
        <h1 className="heading mt-2.5 text-[28px]">
          Ce contenu n&apos;existe plus
        </h1>
        <p className="mt-2.5 text-sm text-muted">
          Le dossier ou la vidéo a été supprimé, ou le lien est erroné.
        </p>

        <Link href="/" className="btn btn-ghost mt-7">
          Retour aux projets
        </Link>

        <div aria-hidden className="mt-10 h-px bg-line/70" />
      </div>
    </main>
  );
}
