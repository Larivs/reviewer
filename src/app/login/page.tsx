import { redirect } from "next/navigation";
import { asc, ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { AUTH_DISABLED } from "@/lib/config";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";
import { LoginBackdrop } from "./backdrop";

// La page lit la base à chaque affichage : jamais de rendu figé au build.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Rien à afficher tant que l'authentification est débrayée.
  if (AUTH_DISABLED) redirect("/");
  if (await getCurrentUser()) redirect("/");

  // Instance fraîchement clonée : on installe avant de demander à quelqu'un
  // de se connecter à un espace qui n'a pas encore de propriétaire.
  const total = db.select({ id: users.id }).from(users).all().length;
  if (total === 0) redirect("/installation");

  // Seulement le studio, jamais les invités.
  //
  // La liste déroulante était pratique à trois personnes qui se connaissent.
  // Avec des clients, elle devient un annuaire : le client Renault y lirait
  // le nom du client Decathlon, donc l'existence d'un concurrent chez le
  // même prestataire. Les comptes du studio y restent — ce sont eux qui se
  // connectent tous les jours — et tout le monde peut saisir son nom.
  const names = db
    .select({ name: users.name })
    .from(users)
    .where(ne(users.role, "invite"))
    .orderBy(asc(users.name))
    .all()
    .map((u) => u.name);

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6">
      {/* Bobine qui tourne : la masse est à gauche, le centre droit reste
          vide — c'est là que se pose le formulaire. */}
      <LoginBackdrop />
      {/* Voile : garantit le contraste du formulaire quelle que soit la
          taille de fenêtre, et assombrit les bords pour concentrer l'œil. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(75% 65% at 50% 50%, rgba(7,9,14,0.34) 0%, rgba(7,9,14,0.90) 100%)",
        }}
      />

      {/* Colonne élargie de 340 à 400 px : le texte de cet écran a été
          grossi, et il fallait la place pour qu'il respire. C'est le seul
          écran de l'app sans interface dense — il peut se permettre d'être
          lisible de loin, contrairement à la page de review où chaque pixel
          pris au texte est un pixel d'image en moins. */}
      <div className="relative w-full max-w-[400px]">
        {/* Le décompte d'amorce, entre deux filets. Les perforations de
            bobine qui les remplaçaient étaient la marque la plus datée de
            l'écran ; le rituel du « 3 2 1 », lui, reste juste. */}
        <div aria-hidden className="mb-7 flex items-center gap-3">
          <span className="h-px w-full bg-line" />
          <span className="shrink-0 whitespace-nowrap font-mono text-[12px] tracking-[0.3em] text-muted">
            3 2 1
          </span>
          <span className="h-px w-full bg-line" />
        </div>

        <div className="text-center">
          <div className="flex items-center justify-center gap-2.5">
            <Logo className="size-[30px] text-accent" />
            <h1 className="wordmark text-[30px]">
              Reviewer
            </h1>
          </div>
          <p className="label mt-3 !text-[13px] !tracking-[0.18em] !text-fg-dim">
            Review vidéo au timecode
          </p>
        </div>

        <div className="mt-8 rounded-lg border border-line bg-surface/85 p-6 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
          <LoginForm names={names} />
        </div>

        <div aria-hidden className="mt-7 h-px bg-line/70" />
      </div>
    </main>
  );
}
