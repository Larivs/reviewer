import "server-only";

/**
 * Court-circuite l'authentification pendant le développement : plus besoin
 * de se reconnecter à chaque redémarrage. Piloté par data/.env.local, donc
 * réactivable sans toucher au code.
 *
 * À remettre à 0 avant d'ouvrir l'app à d'autres postes.
 */
export const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";

if (AUTH_DISABLED) {
  console.warn(
    "\n  ⚠  AUTH_DISABLED=1 — l'authentification est désactivée.\n" +
      "     N'expose pas ce serveur au réseau dans cet état.\n" +
      "     Repasse à 0 dans .env.local pour la réactiver.\n",
  );
}
