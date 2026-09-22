# Sécurité

## Modèle de menace

Reviewer est **auto-hébergé**. Ce qu'il protège, et contre qui, dépend donc
d'abord de l'endroit où tu le poses. Le code part des hypothèses suivantes :

- Le serveur tourne sur une machine que tu contrôles, sur un réseau privé ou
  derrière un reverse proxy HTTPS.
- Les comptes du studio ont un mot de passe. Les clients entrent par un lien
  de partage, sans mot de passe.
- **Qui détient un lien de partage a l'accès que porte ce lien.** C'est le
  compromis assumé de la fonctionnalité, pas un défaut. Le garde-fou est
  l'expiration, revérifiée à chaque affichage.
- Personne, dans l'espace, n'est activement hostile aux autres. L'app cloisonne
  les invités les uns des autres ; elle ne résiste pas à un administrateur
  malveillant, qui voit tout par construction.

## Ce qui est en place

- Mots de passe hachés en **argon2id**.
- Sessions en base, cookie `httpOnly` ; la base ne garde que l'empreinte
  SHA-256 du jeton, une fuite du fichier ne permet pas d'usurper une session.
- Cookie `secure` automatique dès que la requête arrive en HTTPS.
- **Un point de contrôle unique** (`src/lib/access.ts`) pour toute lecture :
  pages, flux vidéo, vignettes, planches d'aperçu, notes. Aucune route ne lit
  la base sans passer par lui.
- Réponses en **404 plutôt qu'en 403** hors de portée : on ne confirme pas
  l'existence de ce qu'on ne doit pas voir.
- Limitation des tentatives de connexion.
- Envois écrits au fil de l'eau, plafonnés, avec vérification du contenu par
  ffprobe, pas seulement de l'extension.

## Ce qui n'est pas en place

Dit franchement, pour que personne ne le découvre au mauvais moment :

- **Pas de double authentification.**
- **Pas de journal d'audit.** On ne sait pas qui a consulté quoi.
- **Pas de chiffrement au repos.** Qui a accès au disque a accès aux vidéos et
  à la base.
- **Pas de protection CSRF explicite** au-delà de ce que fournissent les
  actions serveur de Next et le cookie `SameSite=Lax`.
- **Aucune limite de débit** sur les routes de lecture.
- `AUTH_DISABLED=1` supprime **tout** contrôle d'accès. `npm run serve` refuse
  de démarrer dans cet état, mais `npm run dev` ne refuse rien.

## Signaler une faille

Ouvre une *security advisory* sur le dépôt GitHub plutôt qu'une issue
publique, le temps qu'un correctif existe.

Le projet est maintenu par une seule personne, sur son temps : il n'y a ni
délai de réponse garanti, ni prime. C'est plus honnête à dire qu'à laisser
deviner.
