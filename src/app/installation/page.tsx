import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { instanceIsInstalled } from "@/actions/share";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

/**
 * Première installation, pour qui vient de cloner le dépôt.
 *
 * `npm run seed` existe toujours et reste le chemin en ligne de commande.
 * Mais demander à quelqu'un d'ouvrir un terminal et de répondre à des
 * invites masquées pour créer son premier compte, c'est perdre la moitié
 * des gens avant la première image.
 *
 * Aucun secret à transmettre pour protéger cette page : elle ne s'affiche
 * que tant qu'aucun compte n'existe, et la fenêtre se referme d'elle-même à
 * la seconde où le premier est créé. L'action serveur revérifie la même
 * condition — la page seule ne protège rien.
 */
export default async function InstallPage() {
  if (await instanceIsInstalled()) redirect("/login");

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6">
      <div className="ambience-cool" aria-hidden />
      <div className="relative w-full max-w-[420px]">
        <div className="flex items-center gap-2.5">
          <Logo className="size-[22px] text-accent" />
          <span className="wordmark text-[13px] text-fg">Reviewer</span>
        </div>

        <div className="mt-6 rounded-lg border border-line bg-surface/85 p-6 backdrop-blur-md">
          <p className="label !text-[12px]">Première installation</p>
          <h1 className="heading mt-2 text-[24px]">Crée ton compte</h1>
          <p className="mt-2 text-sm text-muted">
            Cette instance est ton espace. Tu en es l&apos;administrateur : tu
            y déposeras tes montages, et tu enverras des liens de review à tes
            clients.
          </p>

          <div className="mt-6">
            <SetupForm />
          </div>
        </div>
      </div>
    </main>
  );
}
