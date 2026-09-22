import { getScope, requireViewer } from "@/lib/access";
import { AppHeader } from "@/components/app-header";
import { FolderBrowser } from "@/components/folder-browser";
import { Ambience } from "@/components/ambience";
import { Tour } from "@/components/tour/tour";
import { PROJECTS_TOUR } from "@/components/tour/steps";

// La page lit la base à chaque affichage : jamais de rendu figé au build.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireViewer();
  // Un invité n'a pas de racine d'espace : la portée fait que la page
  // d'accueil lui présente directement ses projets. Voir `listFolders`.
  const scope = await getScope();

  return (
    <>
      <Ambience />
      <AppHeader user={user} />
      {/* Colonne pleine hauteur : la zone de dépôt prend la place laissée
          libre au lieu de flotter au-dessus d'un grand vide noir. */}
      <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-[1600px] flex-col px-6 py-6">
        <FolderBrowser parentId={null} viewer={user} scope={scope} />
      </main>
      <Tour id="projects" steps={PROJECTS_TOUR} />
    </>
  );
}
