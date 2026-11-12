"use client";

/**
 * Filet pour tout ce qui lève pendant un rendu ou une action serveur : une
 * coupure réseau, un serveur qu'on redémarre, un poste qui sort de veille.
 * Sans ce fichier, Next remplaçait la page par son écran d'erreur générique,
 * en anglais et sans issue.
 */
export default function ErrorPage({ retry }: { error: Error; retry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-[400px] rounded-lg border border-line bg-surface p-6">
        <h1 className="heading text-[22px]">Le serveur n&apos;a pas répondu</h1>
        <p className="mt-2 text-sm text-muted">
          La connexion a été coupée ou le serveur redémarre. Rien n&apos;est
          perdu côté serveur : réessaie dans un instant.
        </p>
        <button type="button" onClick={() => retry()} className="btn btn-primary mt-5 !py-1.5">
          Réessayer
        </button>
      </div>
    </main>
  );
}
