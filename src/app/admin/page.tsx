import Link from "next/link";
import { listAccounts, requireAdmin } from "@/lib/access";
import { listFolderOptions } from "@/lib/folders";
import { AppHeader } from "@/components/app-header";
import { AccountsPanel } from "@/components/accounts-panel";
import { ShareLinksPanel } from "@/components/share-links-panel";
import { listShareLinks } from "@/lib/share";

export const dynamic = "force-dynamic";

/**
 * Les comptes de l'espace.
 *
 * Une instance = un espace : Hugo fait tourner la sienne, Jérôme la sienne.
 * Il n'y a donc rien à administrer au-dessus, seulement qui entre ici, avec
 * quel rôle, et sur quels projets.
 *
 * `requireAdmin` rend un 404 et non un refus : un membre n'a pas à découvrir
 * qu'une page d'administration existe.
 */
export default async function AdminPage() {
  const admin = await requireAdmin();
  const accounts = listAccounts();
  // Tous les dossiers, chemin complet compris : c'est l'admin qui choisit,
  // et il voit tout l'espace par définition.
  const projects = listFolderOptions();
  const links = listShareLinks();

  return (
    <>
      <AppHeader user={admin} />

      <main className="mx-auto max-w-[900px] px-6 py-6">
        <div className="min-w-0">
          <Link href="/" className="label transition-colors hover:!text-fg">
            ← Projets
          </Link>
          <h1 className="heading mt-1.5 text-[26px]">Comptes</h1>
          <p className="mt-1.5 max-w-[60ch] text-sm text-muted">
            Cette instance est ton espace. Les comptes que tu ouvres ici s&apos;y
            connectent depuis le réseau, un membre voit tout, un invité ne voit
            que les projets que tu lui coches.
          </p>
        </div>

        <div className="mt-6">
          <ShareLinksPanel links={links} />
        </div>

        <div className="mt-8">
          <AccountsPanel
            accounts={accounts}
            projects={projects}
            currentUserId={admin.id}
          />
        </div>
      </main>
    </>
  );
}
