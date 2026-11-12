import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVideoView, videoCapabilities } from "@/lib/access";
import { userColorIndex } from "@/lib/users";
import { listVersions } from "@/lib/videos";
import { getBreadcrumb } from "@/lib/folders";
import { countOpenComments, listComments } from "@/lib/comments";
import { AppHeader } from "@/components/app-header";
import { Tour } from "@/components/tour/tour";
import { REVIEW_TOUR } from "@/components/tour/steps";
import { ReviewWorkspace } from "@/components/review-workspace";
import { StatusPicker } from "@/components/status-picker";
import { ShareButton } from "@/components/share-button";
import { VersionsBar } from "@/components/versions-bar";
import { recordLinkEvent } from "@/lib/link-activity";
import { ProcessingNotice } from "@/components/processing-notice";
import { isStaff } from "@/lib/access";
import { formatSize } from "@/lib/format";
import { formatClock } from "@/lib/timecode";

export const dynamic = "force-dynamic";

export default async function VideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Deviner l'identifiant d'une vidéo ne suffit pas : `requireVideoView`
  // rend un 404 si elle est hors de la portée du compte.
  const { viewer: user, video } = await requireVideoView(id);

  const trail = video.folderId ? getBreadcrumb(video.folderId) : [];
  const backHref = video.folderId ? `/f/${video.folderId}` : "/";
  const backLabel = trail.length > 0 ? trail[trail.length - 1].name : "Projets";
  const versions = listVersions(video);
  const previous = versions.filter((v) => v.version < video.version).pop();
  const can = videoCapabilities(user, video);
  const staff = isStaff(user);
  const comments =
    video.state === "ready" ? listComments(video.id, { includeInternal: staff }) : [];
  // Journal du lien : ce visiteur a ouvert la vidéo.
  recordLinkEvent(can.linkIds, "viewed", user.name, video.id);
  // Qui proposer après un `@` : ceux qui ont déjà parlé sur cette vidéo, et
  // soi-même exclu. Pas la liste des comptes, un client n'a pas à lire le
  // nom des autres clients du studio.
  const people = [
    ...new Set(comments.flatMap((c) => [c.authorName, ...c.replies.map((r) => r.authorName)])),
  ].filter((name) => name !== user.name);

  return (
    <>
      <AppHeader user={user} />

      <main className="mx-auto max-w-[1600px] px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={backHref}
              className="label shrink-0 transition-colors hover:!text-fg"
            >
              ← {backLabel}
            </Link>
            <span aria-hidden className="text-line-strong">
              /
            </span>
            <h1 className="heading heading-sm truncate text-[15px]">
              {video.name}
              {versions.length > 1 && (
                <span className="ml-2 font-mono text-[12px] text-accent">v{video.version}</span>
              )}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Partager un montage precis : le geste le plus courant, donc
                il est la ou on regarde le montage. Reserve au studio : un
                invite ne rouvre pas a d'autres ce qu'on lui a ouvert. */}
            {isStaff(user) && (
              <ShareButton target={{ kind: "video", id: video.id }} label={video.name} />
            )}
            {can.download && video.state !== "processing" && (
              <a
                href={`/api/videos/${video.id}/stream?download=1`}
                download
                title="Télécharger le fichier d'origine"
                className="btn btn-ghost !py-1"
              >
                Télécharger
              </a>
            )}
            <StatusPicker videoId={video.id} status={video.status} size="md" />
            {/* Fiche technique, à la manière d'un rapport de tournage. */}
            <span className="label">
              {formatClock(video.duration ?? 0)}
              {video.fps ? ` · ${video.fps} ips` : ""} · {formatSize(video.size)}
            </span>
          </div>
        </div>

        <VersionsBar
          versions={versions.map((v) => ({ id: v.id, version: v.version, createdAt: v.createdAt }))}
          currentId={video.id}
          canManage={isStaff(user)}
          carry={
            previous
              ? { fromVersion: previous.version, open: countOpenComments(previous.id) }
              : null
          }
        />

        {video.state === "ready" ? (
          <ReviewWorkspace
            // Une version est une autre vidéo : sans clé, passer de la v2 à
            // la v3 garderait le lecteur, sa position et le brouillon de note.
            key={video.id}
            videoId={video.id}
            duration={video.duration}
            fps={video.fps}
            comments={comments}
            people={people}
            canInternal={staff}
            // Le nom et la date, pas un identifiant : c'est fait pour être lu
            // par celui qui filmerait son écran.
            watermark={
              can.watermark
                ? `${user.name}  ${new Date().toLocaleDateString("fr-FR")}`
                : null
            }
            currentUserId={user.id}
            currentUserColor={userColorIndex(user.id)}
          />
        ) : (
          <ProcessingNotice failed={video.state === "failed"} />
        )}
      </main>

      <Tour id="review" steps={REVIEW_TOUR} />
    </>
  );
}
