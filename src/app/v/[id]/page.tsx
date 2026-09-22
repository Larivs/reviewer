import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVideoView } from "@/lib/access";
import { userColorIndex } from "@/lib/users";
import { getVideo } from "@/lib/videos";
import { getBreadcrumb } from "@/lib/folders";
import { listComments } from "@/lib/comments";
import { AppHeader } from "@/components/app-header";
import { Tour } from "@/components/tour/tour";
import { REVIEW_TOUR } from "@/components/tour/steps";
import { ReviewWorkspace } from "@/components/review-workspace";
import { StatusPicker } from "@/components/status-picker";
import { ShareButton } from "@/components/share-button";
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
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Partager un montage precis : le geste le plus courant, donc
                il est la ou on regarde le montage. Reserve au studio : un
                invite ne rouvre pas a d'autres ce qu'on lui a ouvert. */}
            {isStaff(user) && (
              <ShareButton target={{ kind: "video", id: video.id }} label={video.name} />
            )}
            <StatusPicker videoId={video.id} status={video.status} size="md" />
            {/* Fiche technique, à la manière d'un rapport de tournage. */}
            <span className="label">
              {formatClock(video.duration ?? 0)}
              {video.fps ? ` · ${video.fps} ips` : ""} · {formatSize(video.size)}
            </span>
          </div>
        </div>

        <ReviewWorkspace
          videoId={video.id}
          duration={video.duration}
          fps={video.fps}
          comments={listComments(video.id)}
          currentUserId={user.id}
          currentUserColor={userColorIndex(user.id)}
        />
      </main>

      <Tour id="review" steps={REVIEW_TOUR} />
    </>
  );
}
