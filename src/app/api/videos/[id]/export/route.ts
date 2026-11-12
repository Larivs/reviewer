import { isGuest, readVideoOr404 } from "@/lib/access";
import { listComments } from "@/lib/comments";
import {
  EXPORT_FORMATS,
  EXPORT_MIME,
  toCsv,
  toEdl,
  toPremiereXml,
  toText,
  type ExportFormat,
} from "@/lib/export";

export const dynamic = "force-dynamic";

/**
 * Les notes d'une vidéo en fichier : `?format=xml`, `edl`, `csv` ou `txt`.
 * Mêmes droits que pour les lire à l'écran.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await readVideoOr404(id);
  if (access instanceof Response) return access;
  const { video, viewer } = access;

  const format = new URL(request.url).searchParams.get("format") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format))
    return new Response("Format inconnu", { status: 400 });

  const comments = listComments(id, { includeInternal: !isGuest(viewer) });
  const title = video.version > 1 ? `${video.name} v${video.version}` : video.name;
  const body =
    format === "edl"
      ? toEdl(title, comments, video.fps)
      : format === "xml"
        ? toPremiereXml(title, comments, video.fps, video.duration)
        : format === "csv"
          ? toCsv(comments, video.fps)
          : toText(title, comments, video.fps);

  // Le nom vient de l'utilisateur : une forme ASCII pour les vieux clients,
  // et la forme exacte encodée pour les autres.
  const ascii = title.replace(/[^\w .-]+/g, "_").slice(0, 80) || "notes";
  const exact = encodeURIComponent(`${title}.${format}`);

  return new Response(body, {
    headers: {
      "Content-Type": EXPORT_MIME[format],
      "Content-Disposition": `attachment; filename="${ascii}.${format}"; filename*=UTF-8''${exact}`,
      "Cache-Control": "no-store",
    },
  });
}
