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

## Upload et lecture

L'envoi se fait en corps de requête brut, écrit sur le disque au fil de l'eau :
un fichier de plusieurs gigaoctets ne passe jamais entièrement en mémoire.
Plafond à 25 Go, vérifié en comptant les octets reçus et pas seulement d'après
l'en-tête `Content-Length`. Les fichiers partent un par un, deux envois
simultanés se partagent la même bande passante et finissent tous les deux plus
tard.

La lecture passe par une route qui gère les requêtes `Range` (206 Partial
Content). C'est ce qui rend le déplacement dans la vidéo instantané, et c'est
la base sur laquelle reposent les commentaires au timecode.

Pas de reprise après interruption : en cas de coupure, l'envoi est à refaire.

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
seconde, `,`/`.` une image (convention Premiere), J/L une seconde, 0-9 pour
aller à un pourcentage, Début/Fin, M le son, F le plein écran, R la boucle,
Ctrl+molette le zoom. La liste est dépliable sous le lecteur.

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

Survoler la piste affiche la vignette de l'instant pointé. Elle vient d'une
**planche de 10 × 10 images** générée à l'upload, chargée seulement au premier
survol : 180 Ko qu'on ne télécharge pas si personne ne survole. Les vidéos
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
Chaque note apparaît aussi en repère sur la piste de
lecture, vert quand elle est résolue. Ces repères ne mesurent que 8 × 7 px :
leur zone de clic est élargie en dehors du dessin, sinon on ne les vise pas.

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

Les deux types se distinguent par la **forme**, pas par la couleur : la
palette n'a qu'un accent et en ajouter un affaiblirait la règle « accent =
demande attention ». Une note ponctuelle est un triangle plein, une plage un
crochet entrée/sortie, montants aux deux bouts, trait mince entre les deux,
la notation du montage. Le repère de la note sous la tête de lecture est mis
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
