import Link from "next/link";
import { requireVideoView } from "@/lib/access";
import { AppHeader } from "@/components/app-header";
import { CompareView } from "@/components/compare-view";
import type { Video } from "@/lib/videos";

export const dynamic = "force-dynamic";

/** `Montage v2`, ou le nom seul quand la vidéo n'a qu'une version. */
function label(video: Video, sameStack: boolean) {
  return sameStack ? `v${video.version}` : video.name;
}

/**
 * Deux vidéos côte à côte, synchronisées. Faites pour deux versions d'un
 * même montage, mais rien n'empêche de comparer deux vidéos quelconques.
 *
 * Les deux passent par `requireVideoView` : comparer ne doit pas devenir une
 * façon de voir une vidéo hors de sa portée.
 */
export default async function ComparePage({
  params,
}: {
  params: Promise<{ a: string; b: string }>;
}) {
  const { a: aId, b: bId } = await params;
  const { viewer, video: a } = await requireVideoView(aId);
  const { video: b } = await requireVideoView(bId);
  const sameStack = a.stackId !== null && a.stackId === b.stackId;

  return (
    <>
      <AppHeader user={viewer} />
      <main className="mx-auto max-w-[1600px] px-6 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/v/${b.id}`} className="label shrink-0 transition-colors hover:!text-fg">
            ← Retour à la review
          </Link>
          <span aria-hidden className="text-line-strong">
            /
          </span>
          <h1 className="heading heading-sm truncate text-[15px]">
            {sameStack ? `${b.name} : v${a.version} et v${b.version}` : `${a.name} et ${b.name}`}
          </h1>
        </div>

        {a.state === "ready" && b.state === "ready" ? (
          <CompareView
            a={{ id: a.id, label: label(a, sameStack), duration: a.duration, fps: a.fps }}
            b={{ id: b.id, label: label(b, sameStack), duration: b.duration, fps: b.fps }}
          />
        ) : (
          <p className="mt-6 text-sm text-muted">
            L&apos;une des deux vidéos est encore en conversion. Reviens dans un instant.
          </p>
        )}
      </main>
    </>
  );
}
