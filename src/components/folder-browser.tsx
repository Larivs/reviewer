import { getBreadcrumb, listFolderOptions, listFolders } from "@/lib/folders";
import { listVideos } from "@/lib/videos";
import { isStaff, type Scope, type Viewer } from "@/lib/access";
import { Breadcrumb } from "./breadcrumb";
import { FolderCard } from "./folder-card";
import { LiveGrid } from "./live-grid";
import { NewFolder } from "./new-folder";
import { UploadZone } from "./upload-zone";
import { ShareButton } from "./share-button";
import { VideoCard } from "./video-card";

function SectionTitle({
  children,
  count,
}: {
  children: React.ReactNode;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <h2 className="label !text-fg-dim">{children}</h2>
      {/* Le décompte est une information, pas une décoration : il était en
          `line-strong`, c'est-à-dire illisible. */}
      <span className="rounded-sm bg-surface-2 px-1.5 py-px font-mono text-[10px] tabular-nums text-muted">
        {count}
      </span>
      {/* Filet qui court jusqu'au bord : structure la page sans encadrer. */}
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

export function FolderBrowser({
  parentId,
  viewer,
  scope,
}: {
  parentId: string | null;
  viewer: Viewer;
  scope: Scope;
}) {
  // Le fil d'Ariane s'arrête à la portée : un invité ne doit pas lire le nom
  // des dossiers au-dessus du projet qu'on lui a ouvert, ni pouvoir y monter.
  const trail = (parentId ? getBreadcrumb(parentId) : []).filter(
    (f) => scope === null || scope.visible.has(f.id),
  );
  const folders = listFolders(parentId, scope);
  const videos = listVideos(parentId, scope);
  // Les destinations sont les mêmes pour toutes les vignettes : une seule
  // lecture de l'arbre ici plutôt qu'une par carte.
  const destinations = videos.length > 0 ? listFolderOptions(scope) : [];
  const empty = folders.length === 0 && videos.length === 0;
  const title = trail.length > 0 ? trail[trail.length - 1].name : "Projets";
  // Créer, déplacer, déposer : le rangement de l'espace appartient au studio.
  const canManage = isStaff(viewer);

  return (
    <>
      {/* Fil d'Ariane en retrait, titre en capitales lourdes en dessous :
          la page a un sommet, et le nom du dossier n'a plus la même voix
          que les micro-libellés. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <Breadcrumb trail={trail} />
          <h1 className="heading mt-1.5 truncate text-[26px]" title={title}>
            {title}
          </h1>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            {/* Partager le projet entier : pour le client recurrent, qui
                suivra les versions successives au meme endroit. */}
            {parentId !== null && (
              <ShareButton target={{ kind: "folder", id: parentId }} label={title} />
            )}
            <div data-tour="new-folder">
              <NewFolder parentId={parentId} />
            </div>
          </div>
        )}
      </div>

      {folders.length > 0 && (
        <section className="mt-6">
          <SectionTitle count={folders.length}>Dossiers</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {folders.map((folder, i) => (
              <div
                key={folder.id}
                className="rise"
                // Cascade courte : la grille se pose, elle ne défile pas.
                style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
              >
                <FolderCard folder={folder} />
              </div>
            ))}
          </div>
        </section>
      )}

      {videos.length > 0 && (
        <section className="mt-7">
          <SectionTitle count={videos.length}>Vidéos</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {videos.map((video, i) => (
              <div
                key={video.id}
                className="rise"
                style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
                /* Le guide encadre la première vignette : elle sert
                   d'exemple pour toutes les autres. */
                data-tour={i === 0 ? "video-card" : undefined}
              >
                <VideoCard video={video} folders={destinations} canManage={canManage} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quand il n'y a rien, la zone de dépôt porte elle-même l'état vide :
          deux encadrés en pointillés qui se suivaient en disant la même
          chose, ça faisait doublon. */}
      {canManage ? (
        <UploadZone folderId={parentId} empty={empty} atRoot={parentId === null} />
      ) : (
        empty && (
          <p className="mt-6 text-sm text-muted">
            Rien à review ici pour le moment.
          </p>
        )
      )}

      {/* Dernier enfant, sans clé et sans enveloppe : les sections
          conditionnelles occupent leur emplacement même quand elles valent
          `false`, donc la zone d'envoi garde son numéro d'emplacement — et
          avec lui sa fibre, sa file d'envoi et sa requête en vol. Enrober ou
          re-clé cet arbre casserait un envoi en cours. */}
      <LiveGrid />
    </>
  );
}
