import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getViewer } from "@/lib/access";
import {
  describeLink,
  getLinkByToken,
  linkDestination,
  linkIsExpired,
} from "@/lib/share";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";

/**
 * La porte d'entrée d'un client.
 *
 * Un lien mort et un lien qui n'a jamais existé mènent au même écran, avec
 * le même texte : distinguer les deux dirait à qui tâtonne lesquels de ses
 * essais tombent juste.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = getLinkByToken(token);

  if (!link || linkIsExpired(link)) return <Dead />;

  // Déjà dans la place, le studio qui vérifie son propre lien, ou le client
  // qui revient avec son cookie. On ne lui redemande pas son prénom.
  const viewer = await getViewer();
  if (viewer) redirect(linkDestination(link));

  const target = describeLink(link);

  return (
    <Shell>
      <p className="label !text-[12px]">Review partagée</p>
      <h1 className="heading mt-2 text-[26px]">
        {target ?? "Une vidéo t'attend"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        Tu peux regarder, commenter à l&apos;image près et répondre aux autres.
      </p>
      <div className="mt-6">
        <JoinForm token={token} target={target} />
      </div>
    </Shell>
  );
}

function Dead() {
  return (
    <Shell>
      <p className="label !text-[12px]">Lien de review</p>
      <h1 className="heading mt-2 text-[26px]">Ce lien n&apos;est plus valide</h1>
      <p className="mt-2 text-sm text-muted">
        Il a expiré, ou il a été fermé. Demande-en un nouveau à la personne qui
        te l&apos;a envoyé.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6">
      <div className="ambience-cool" aria-hidden />
      <div className="relative w-full max-w-[400px]">
        <div className="flex items-center gap-2.5">
          <Logo className="size-[22px] text-accent" />
          <span className="wordmark text-[13px] text-fg">Reviewer</span>
        </div>
        <div className="mt-6 rounded-lg border border-line bg-surface/85 p-6 backdrop-blur-md">
          {children}
        </div>
      </div>
    </main>
  );
}
