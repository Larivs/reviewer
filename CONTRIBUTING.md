# Contribuer

Les correctifs et les rapports de bug sont bienvenus.

## Avant d'ouvrir une pull request

```bash
npx tsc --noEmit    # le typage doit passer
npm run build       # et la compilation aussi
```

**Un `tsc` vert ne suffit pas.** Certaines fautes ne se voient qu'au bundler :
un composant client qui importe un module marqué `server-only` compile
parfaitement, puis casse au chargement avec une cascade d'erreurs `Can't
resolve 'fs'` venues de SQLite. Charge au moins une page avant de soumettre.

## Les partis pris

Le projet en a de tranchés. Ils sont expliqués dans
[`docs/conception.md`](docs/conception.md) et dans les commentaires du code -
c'est là qu'il faut regarder avant de proposer un changement de fond. La
plupart des décisions qui semblent arbitraires sont la réponse à un problème
précis, et le problème est écrit.

Si tu n'es pas d'accord avec l'un d'eux, ouvre une issue avant d'écrire le
code : on discutera du problème plutôt que du patch.

Quelques-uns, pour situer :

- **Une instance = un espace.** Pas de multi-tenant.
- **L'accent ne décore jamais.** Il signale ce qui est actif ou attend une
  action, et rien d'autre.
- **Aucune dépendance à un service tiers.** Ni CDN, ni police distante, ni
  API externe : l'app doit fonctionner sur un réseau fermé.
- **Pas de dossier de migrations.** Le schéma s'applique au démarrage, de
  façon idempotente.

## Le style des commentaires

Les commentaires de ce dépôt expliquent **pourquoi**, pas **quoi**. Un
commentaire qui paraphrase la ligne suivante sera retiré ; un commentaire qui
raconte l'impasse évitée, la mesure qui a tranché ou le bug qu'on a mis deux
heures à comprendre sera gardé.

Ils sont en français, comme l'interface.
