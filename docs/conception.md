# Notes de conception

Ce document explique **pourquoi** l'app est faite comme elle est. Les choix
évidents n'y sont pas ; les impasses qui expliquent les choix bizarres, si.

C'est la lecture à faire avant de proposer un changement de fond : la plupart
des décisions qui semblent arbitraires sont la réponse à un problème précis,
et le problème est écrit.

## Structure

```
src/
  app/
    /                     la grille des projets
    /f/[id]               un dossier
    /v/[id]               l'espace de review d'une vidéo
    /admin                comptes et liens de partage
    /r/[token]            entrée d'un client par un lien
    /login  /installation  /lien-expire
    api/upload            réception des fichiers (flux)
    api/videos/[id]/…     stream (HTTP Range), vignette, sprite, notes
  actions/        actions serveur (mutations)
  components/     composants d'interface
  db/             schéma Drizzle + DDL SQLite
  lib/
    access.ts     LE point de contrôle : qui voit quoi
    scope.ts      la portée d'un compte, sans dépendance
    share.ts      liens de partage
    auth, folders, videos, media, comments, format, timecode…
scripts/          serve, seed, sprites, backup
docs/             ce document
Reviewer.cmd      lanceur Windows (double-clic)
data/             base, vidéos, vignettes (hors git)
```

Deux fichiers portent une contrainte particulière : `scope.ts` et
`share-types.ts` n'importent **rien**. Ils contiennent ce qui est partagé
entre le serveur et le navigateur, et c'est cette absence de dépendance qui
évite deux pièges, un cycle d'imports entre la couche d'accès et les lectures
de données, et l'entraînement de SQLite dans le paquet client par un composant
qui n'aurait importé qu'un type.

## Arborescence

Dossiers imbriqués sans limite de profondeur (`folders.parent_id`
auto-référencé). Deux dossiers frères ne peuvent pas porter le même nom, à la
casse près.

Supprimer un dossier supprime tout son sous-arbre : la confirmation annonce le
décompte réel, calculé récursivement, et les fichiers vidéo correspondants sont
retirés du disque en même temps que les lignes en base.

## Déposer

Toute la page reçoit les fichiers : un voile couvre l'écran dès qu'un fichier
survole la fenêtre et dit où il ira. Le grand cadre en pointillés qui occupait
le bas de chaque dossier ne reste que sur un dossier vide, où il porte l'état
vide ; ailleurs il se réduit à une ligne.

## Sécurité

**Tant que `AUTH_DISABLED=1`, il n'y a aucun contrôle d'accès** : ne pas
exposer le serveur hors de la machine dans cet état. `npm run serve` refuse de
démarrer dans cette configuration.

Mots de passe hachés en argon2id. Sessions en base, cookie `httpOnly`, le
token n'est jamais lisible en JavaScript, et la base n'en garde que
l'empreinte SHA-256 : une fuite du fichier ne permet pas d'usurper une
session. Le cookie passe en `secure` dès que la requête arrive en HTTPS,
détecté sur `x-forwarded-proto`. En HTTP local rien ne change, un cookie
`secure` y serait ignoré et plus personne ne pourrait se connecter.

**Une session valide ne suffit pas.** Toute lecture passe par
`lib/access.ts`, qui répond à une seule question : ce compte a-t-il le droit
de voir *cette* vidéo ? Les routes ne lisent plus la base directement. C'est
un choix de forme autant que de fond, une règle d'accès dispersée dans vingt
fichiers est une règle qu'on oublie d'appliquer au vingt-et-unième.

Les vidéos ne sont pas servies en statique : elles passent par une route qui
applique cette règle, sinon deviner une URL suffirait à contourner le mot de
passe. Cela vaut aussi pour les vignettes, les planches d'aperçu et les notes.

Hors de portée, la réponse est **404 et non 403** : dire « interdit »
confirmerait l'existence d'un projet à quelqu'un qui n'a pas à savoir qu'il
existe.

Un compte né d'un lien de partage voit son lien revérifié **à chaque
affichage**, et pas seulement à l'ouverture. Sans ça, l'expiration serait
décorative : le cookie de session dure trente jours et survivrait largement au
lien.

**Un droit venu d'un lien porte ce lien** (`link_id` sur `folder_grants` et
`video_grants`). Avant, fermer un lien retirait les droits des comptes *nés*
de ce lien, et de ceux-là seulement : un invité entré d'abord par un autre
lien, ou un compte ouvert à la main, gardait pour toujours ce que le lien
fermé lui avait ouvert, sans que rien ne l'affiche. La portée ne retient donc
que les droits posés à la main et ceux dont le lien vit encore, relu à chaque
affichage. Les droits posés depuis la page Comptes ont `link_id` vide et ne
bougent pas quand un lien meurt.

Trois en-têtes sur toutes les réponses (`next.config.ts`) : `nosniff`,
`X-Frame-Options: DENY`, et `Referrer-Policy: same-origin`, ce dernier parce
que l'adresse d'un lien de review est le droit d'entrer et ne doit pas partir
dans un `Referer`.

## Upload et lecture

Le fichier s'écrit sous un nom en `.part`, renommé une fois validé par
ffprobe : un envoi interrompu laisse un reste reconnaissable, gardé une
semaine pour pouvoir reprendre, puis retiré par `npm run serve` au démarrage.
La planche d'aperçu se fabrique
**après** la réponse, une à la fois : elle décode tout le métrage, et
l'attendre gardait la barre d'envoi figée à 100 % pendant des minutes. La
piste la redemande quelques fois tant qu'elle n'est pas prête.

L'envoi se fait par **tranches de 32 Mo**, chacune en corps de requête brut
ajouté au fil de l'eau à un fichier `.part` : un rush de plusieurs gigaoctets
ne passe jamais en mémoire. Le `.part` est nommé d'après le compte et une
empreinte du fichier (nom, taille, date), ce qui permet la reprise : le
navigateur demande au serveur combien d'octets il a, et repart de là. Une
tranche doit commencer exactement à cette position, sinon le serveur répond
409 avec la bonne plutôt que d'écrire au mauvais endroit. Plafond à 25 Go,
vérifié en comptant les octets reçus. Les fichiers partent un par un, deux
envois simultanés se partagent la même bande passante et finissent tous les
deux plus tard.

Un format que le navigateur ne lit pas est converti en H.264 après la
réponse, dans la même file que les planches d'aperçu, un travail ffmpeg à la
fois. La ligne existe tout de suite avec `state = processing`. Une conversion
ne survit pas à un arrêt du serveur : au démarrage, ce qui était en cours
passe en `failed`, mieux vaut le dire que laisser tourner un sablier.

La lecture passe par une route qui gère les requêtes `Range` (206 Partial
Content). C'est ce qui rend le déplacement dans la vidéo instantané, et c'est
la base sur laquelle reposent les commentaires au timecode.


## Versions

Une version est **une vidéo à part entière**, liée aux autres par `stack_id`
(l'id de la première) et numérotée par `version`. Pas de table de piles :
`stack_id` reste vide tant qu'un montage n'a qu'une version, donc rien ne
change pour les vidéos qui n'en auront jamais.

Les notes restent sur leur version et ne sont pas reportées. Une note « le
logo arrive trop tôt » posée sur la v1 n'a pas à réapparaître sur la v2, où
le logo a justement été déplacé ; la reporter obligerait quelqu'un à la
refermer à la main sur chaque version.

La grille ne montre que la dernière version de chaque pile, renommer et ranger
s'appliquent à toute la pile, et un lien de partage vers une vidéo ouvre
**toutes ses versions**, y compris celles déposées après l'envoi du lien :
c'est pour les montrer au client qu'on les dépose.

La comparaison joue deux lecteurs sur une seule horloge. La gauche mène, la
droite est recalée dès qu'elle s'écarte de plus de 60 ms : deux lecteurs
lancés ensemble ne restent pas ensemble, chacun tamponne à son rythme. Le
**volet** superpose les deux images avec une séparation qu'on déplace, c'est
lui qui montre au pixel ce qui a bougé sur un raccord.

## Images et sons

Une image fixe est convertie en une seconde de vidéo, un son en une vidéo dont
l'image est sa forme d'onde. Plutôt qu'une seconde et une troisième
visionneuse, chacune avec son zoom, son calque de dessin et ses notes : tout
passe par le lecteur, et ce qui existe pour une vidéo, annotations, versions,
comparaison en volet, marche sans une ligne de plus. La forme d'onde est en
prime utile, on y voit où sont les silences.

L'original est gardé à côté de la copie lisible (`videos.original`). C'est lui
que rend le téléchargement, y compris pour un ProRes converti.

## Liens : mot de passe, téléchargement, filigrane

Les trois se règlent par lien. Ce qu'un invité peut faire d'une vidéo se
déduit des liens **par lesquels il l'atteint** (`videoCapabilities`) : il
télécharge si l'un d'eux le permet, il est filigrané si l'un d'eux le demande.
Le studio télécharge toujours et n'est jamais filigrané.

Le mot de passe est haché comme celui d'un compte, et ses essais sont comptés
par lien. Un invité déjà connu qui ouvre un lien protégé doit le donner aussi,
seul le studio en est dispensé.

Le filigrane est un calque par-dessus l'image. Il dissuade et signe une
capture d'écran, il ne protège rien : l'incruster dans les pixels demanderait
une conversion par visiteur.

## Notes internes

Une note cochée « interne » n'est envoyée qu'au studio. Le filtre est côté
serveur, sur les trois sorties : la page, la route de sondage, les exports.
Pour un invité elle n'existe pas, y compris s'il devine son identifiant pour
y répondre ou la résoudre.

Le **numéro** d'une note est calculé sur la liste entière, avant le filtre :
un invité voit donc des trous (« 1, 3, 4 »). C'est voulu, renuméroter ferait
de « la note 3 » une note différente pour le client et pour le monteur.

La case se décoche après chaque envoi : restée cochée, elle ferait partir en
interne la note suivante, celle qu'on destinait au client.

## Journal d'un lien

`share_link_events` note ce qui passe par un lien : entrée, visionnage (une
ligne par heure et par vidéo, pas une par rendu), commentaire,
téléchargement. Le nom est recopié dans la ligne pour rester lisible après la
suppression du compte ; les lignes partent avec le lien. C'est un journal, pas
un contrôle : une écriture qui échoue ne refuse rien.

## Mentions et courriel

`@Prénom` est reconnu **côté serveur**, parmi les noms de comptes, en prenant
le plus long nom qui commence après l'arobase (« @Toma (2) » ne prévient pas
Toma). Le navigateur ne reçoit que les noms effectivement cités dans une
note, jamais la liste des comptes : un client n'a pas à lire le nom des autres
clients du studio. Pour la même raison, la saisie ne propose que ceux qui ont
déjà parlé sur la vidéo.

Le courriel est optionnel (`REVIEWER_SMTP_URL`). Le studio est prévenu de
chaque note ; une personne mentionnée ne l'est que si elle a déjà pris part à
la review de cette vidéo, sans quoi mentionner un client lui enverrait le
contenu d'un projet qui n'est pas le sien.

## Le direct

Un flux d'événements (SSE, `/api/events`) prévient les navigateurs qu'une
chose a changé. **Il ne transporte aucune donnée de review**, seulement le
signal : le navigateur relit ensuite par les routes habituelles, qui
appliquent les droits. Un flux resté ouvert après la mort d'un lien n'apprend
donc rien à son porteur.

Tout tient dans le processus (`lib/live.ts`), un émetteur d'événements et une
table des connexions ouvertes pour la présence. Une instance, c'est un serveur
Node : il n'y a pas de second processus à prévenir, donc ni Redis ni file.

Le sondage de fond est resté. Derrière un proxy qui retient les flux, c'est
encore lui qui rattrape au retour sur l'onglet.

## Le lecteur

Contrôles maison plutôt que le lecteur natif du navigateur, pour deux raisons
qui comptent en review : le natif n'affiche pas de timecode en images et ne
permet pas d'avancer image par image.

- **Timecode `HH:MM:SS:FF`**, la notation des logiciels de montage, plus le
  numéro d'image absolu.
- **Déplacement image par image** exact, sans dérive ni image sautée.
- Piste de lecture avec les portions déjà téléchargées et l'emplacement des
  commentaires.
- Vitesse de 0,25× à 2×, volume mémorisé par navigateur.

Raccourcis : Espace/K lecture-pause, flèches une image, Maj+flèches une
seconde, `,`/`.` une image (convention Premiere), J/L la navette, I/O/X les
points de boucle, 0-9 pour aller à un pourcentage, Début/Fin, M le son, F le
plein écran, R la boucle, Ctrl+molette le zoom. La liste est dépliable sous
le lecteur.

**La navette J/K/L** est celle des bancs de montage : L avance, J recule,
chaque appui double la vitesse (1, 2, 4, 8), K arrête. Vers l'avant c'est la
vitesse du lecteur. Vers l'arrière, un élément vidéo ne sait pas lire à
l'envers : on recule la position à chaque rafraîchissement d'écran, sans son.

**La boucle entre deux points** : I pose l'entrée, O la sortie, X les retire.
Boucle (R) activée, un clic sur le repère d'une note tourne de cette note à la
suivante, pour repasser un passage commenté.

### Tenir dans l'écran

L'image est bornée par la **place réellement restante**, pas par une fraction
de la fenêtre. Avec un plafond en `vh`, l'en-tête, le fil d'Ariane, la piste
et la rangée de transport s'ajoutaient par-dessus : sur un 13-14 pouces la
barre de contrôle passait sous le bord bas et il fallait défiler pour
atteindre l'avance image par image. La liste des raccourcis, elle, a le droit
de tomber sous le bord, on ne la consulte pas en regardant un plan.

La rangée de transport se replie sur deux lignes quand sa colonne descend
sous 660 px, via une **requête de conteneur** et non un point de rupture sur
la fenêtre : la même barre est à l'étroit à 1024 px en deux colonnes et au
large à 960 px en une seule, un seuil sur la fenêtre se tromperait dans les
deux sens.

### Zoom et aperçu au survol

Le zoom va de 100 % à 400 %, à la molette avec Ctrl ou aux boutons ; on
recadre ensuite en glissant. Le déplacement est borné pour qu'aucun bord ne
découvre du vide, et revenir à 100 % recentre.

La vidéo **et le calque d'annotation sont transformés ensemble** : sans ça,
les dessins se décrocheraient de l'image dès qu'on agrandit. Vérifié, un
point posé à 0,5/0,5 reste à 0,5/0,5 à 200 %, et on peut dessiner en étant
zoomé.

**La piste est une bande d'images.** Un filet de 4 px disait où on en était,
pas ce qu'il y avait à cet endroit : on cherchait un plan en balayant la barre
et en lisant l'aperçu. Les images sont maintenant posées bout à bout, comme
sur une timeline de montage, sous une règle de timecode. Ce qui reste à voir
recule dans l'ombre plutôt que de recevoir un aplat de couleur, et la tête de
lecture porte un onglet pour se détacher des images.

Tout vient d'une **planche de 10 × 10 images** générée à l'upload. Elle
n'était chargée qu'au premier survol ; elle est le matériau de la page de
review, donc demandée à l'ouverture. Sans planche (vidéo ancienne, conversion
en cours), la piste retombe sur le filet d'avant. Survoler la piste affiche
toujours la vignette de l'instant pointé.

La même planche sert dans la grille : **glisser la souris sur une vignette
fait défiler le film**. Là, elle n'est demandée qu'au premier survol de la
vignette, une grille de quarante vidéos ne télécharge pas quarante planches. Les vidéos
antérieures à cette fonction se rattrapent avec :

```bash
npm run sprites
```

Les raccourcis sont **désactivés dès que le curseur est dans un champ de
saisie** : sans cela, écrire un commentaire mettrait la vidéo en pause à
chaque espace.

Le timecode suit l'image réellement présentée (`requestVideoFrameCallback`)
et non l'événement `timeupdate`, qui ne se déclenche que quatre fois par
seconde, il sauterait de six images en six images. Repli automatique sur
Firefox, qui n'expose pas cette API.

Quand ffprobe n'a pas pu déterminer la cadence, l'affichage passe en
centièmes de seconde plutôt que d'inventer un numéro d'image, et le
déplacement image par image se rabat sur 25 fps.

## Commentaires au timecode

Chaque note est attachée à un instant précis de la vidéo. **Un clic n'importe
où sur la note** y ramène à l'image exacte, la pastille de timecode seule ne
couvrait que 6 % de la carte, il fallait viser. Cliquer un bouton ne navigue
pas, et sélectionner du texte non plus : on peut toujours copier une note.
Chaque note apparaît aussi sur la piste, deux fois. **Sur la bande**, un trait
à la couleur de son auteur, et un bandeau sur toute sa durée pour une plage :
on voit où il y a quelque chose à reprendre sans quitter l'image des yeux.
**Sous la bande**, une pastille de 18 px à son numéro, le même que dans le
panneau. C'étaient des triangles de 8 × 7 px : on ne voyait ni où étaient les
notes, ni laquelle était laquelle. Une note résolue garde sa couleur et
recule en opacité.

**Comment le timecode est capturé.** Se placer dans le champ met la vidéo en
pause : on annote une image, pas un flux qui défile. La puce de timecode suit
la lecture jusqu'à la première frappe, puis se **fige**, le temps d'écrire,
la vidéo aurait avancé, et c'est bien l'image qu'on regardait qu'on veut
référencer. Si on se déplace ensuite, la puce affiche `≠ lecture · recaler`
pour signaler qu'elle ne correspond plus à l'écran.

La position épinglée est lue directement dans le lecteur, pas dans l'état
rafraîchi de la page : ce dernier est volontairement limité à 5 Hz pour ne pas
faire rendre toute la liste à chaque image, ce qui introduirait jusqu'à cinq
images de retard.

**Qui peut quoi.** On ne modifie et ne supprime que ses propres notes ;
réécrire celle d'un autre fausserait la review. En revanche **tout le monde
peut marquer une note comme résolue** : c'est souvent le monteur qui l'applique,
pas celui qui l'a écrite. Ces règles sont appliquées côté serveur, pas
seulement en masquant des boutons.

Les notes sont triées par timecode, l'ordre dans lequel on reprend ses notes,
pas celui où elles ont été écrites. Elles sont **numérotées** dans cet ordre,
pour qu'on puisse dire « la note 3 » au téléphone. Entrée insère un retour à
la ligne (une note est souvent une petite liste), Ctrl + Entrée envoie.

### Notes sur une plage

Une note peut couvrir un intervalle plutôt qu'un instant : on écrit au début,
on arme « Plage », puis on glisse sur la piste. Elle s'affiche
`00:00:04:00 → 00:00:09:00` et apparaît en barre sur la piste, pas en
triangle.

Les repères sont **répartis en rangées** sous la piste, comme un planning :
chacun va dans la première rangée libre à sa position. Sans ça, une note
ponctuelle posée à l'intérieur d'une plage disparaissait sous la barre, on ne
voyait qu'un seul problème là où il y en avait deux. Trois rangées au
maximum, et la zone ne grandit que si elle en a besoin.

Les deux types se distinguent par la **forme**, pas par la couleur, qui dit
déjà *qui* : une note ponctuelle est une pastille ronde, une plage une
pastille étirée sur sa durée. Le repère de la note sous la tête de lecture est mis
en avant, ce qui relie la piste au panneau latéral. Une plage reste active sur tout son intervalle, une note ponctuelle
seulement dans une fenêtre d'une demi-seconde.

### Annotations sur l'image

Quatre outils : point, flèche, cadre, tracé libre. Activer le dessin met la
vidéo en pause et épingle le timecode, on annote une image donnée.

**Les coordonnées sont normalisées entre 0 et 1**, jamais en pixels : une
annotation posée en plein écran se retrouve au même endroit sur une fenêtre
réduite, quelle que soit la définition de la vidéo.

Le calque de dessin se cale sur le **rectangle réellement occupé par l'image**,
pas sur la boîte de l'élément vidéo. Dès que le cadre de l'élément n'a pas le
rapport de la vidéo, le navigateur ajoute des bandes noires : dessiner sur la
boîte décalerait toutes les annotations. Les repères posés sur l'image suivent la
même règle.

Chaque forme est tracée deux fois : un halo sombre, puis le tracé à la
couleur de son auteur. Sans ça, un trait clair sur un plan clair devient
invisible.

L'annotation de la note sous la tête de lecture s'affiche automatiquement sur
l'image ; le brouillon en cours de dessin a la priorité.

Les formes venant du navigateur sont **entièrement reconstruites côté
serveur** avant stockage : type inconnu, `NaN`, coordonnées hors bornes,
formes dégénérées et champs parasites sont écartés, et le nombre de formes
(40) comme de points par tracé (600) est plafonné.
