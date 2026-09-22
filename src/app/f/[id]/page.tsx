import { notFound } from "next/navigation";
import { requireFolderView } from "@/lib/access";
import { getFolder } from "@/lib/folders";
import { AppHeader } from "@/components/app-header";
import { Tour } from "@/components/tour/tour";
import { PROJECTS_TOUR } from "@/components/tour/steps";
import { FolderBrowser } from "@/components/folder-browser";
import { Ambience } from "@/components/ambience";

export const dynamic = "force-dynamic";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Hors portée, c'est un 404 et non un refus : dire « interdit »
  // confirmerait l'existence du projet à qui n'a pas à la connaître.
  const { viewer, scope } = await requireFolderView(id);

  if (!getFolder(id)) notFound();

  return (
    <>
      <Ambience />
      <AppHeader user={viewer} />
      {/* Même colonne pleine hauteur qu'à la racine : voir `app/page.tsx`. */}
      <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-[1600px] flex-col px-6 py-6">
        <FolderBrowser parentId={id} viewer={viewer} scope={scope} />
      </main>
      <Tour id="projects" steps={PROJECTS_TOUR} />
    </>
  );
}
