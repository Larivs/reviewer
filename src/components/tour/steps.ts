import type { TourStep } from "./tour";

/**
 * Deux guides courts plutôt qu'un seul long : la page des projets et l'espace
 * de review. Chacun se lance au premier passage sur sa page, donc
 * l'explication arrive au moment où elle sert.
 *
 * Volontairement réduits à l'essentiel, trois et quatre étapes. La version
 * précédente en comptait onze et décrivait chaque bouton : on la passait sans
 * la lire. Un guide ne montre que les gestes sans lesquels on reste bloqué,
 * déposer, ouvrir, écrire une note, la retrouver. Le reste se découvre, ou se
 * lit dans une infobulle.
 *
 * Une idée par étape, une ou deux phrases, des mots du métier.
 */
export const PROJECTS_TOUR: TourStep[] = [
  {
    title: "Bienvenue",
    body:
      "Ici, on dépose une vidéo, on la commente à l'image près, puis on envoie un lien au client. Trois étapes pour voir comment.",
  },
  {
    target: "upload",
    title: "Déposer",
    body:
      "Glisse tes fichiers n'importe où sur la page. Vidéo, image ou son : tout est accepté, et converti si besoin.",
  },
  {
    target: "video-card",
    title: "Ouvrir",
    body:
      "Clique une vignette pour la commenter. La pastille bleue compte les notes en attente, et glisser la souris sur l'image fait défiler le film.",
    hint: "Ctrl + K pour retrouver un projet",
  },
];

export const REVIEW_TOUR: TourStep[] = [
  {
    target: "note-form",
    title: "Écrire une note",
    body:
      "Arrête la vidéo sur l'image qui pose problème, écris, envoie. La note reste attachée à cette image.",
    hint: "Ctrl + Entrée pour envoyer",
  },
  {
    target: "annotate",
    title: "Montrer du doigt",
    body:
      "« Annoter » dessine sur l'image : flèche, cadre, tracé. « Plage » couvre tout un passage au lieu d'une seule image.",
  },
  {
    target: "timeline",
    title: "Retrouver les notes",
    body:
      "Chaque pastille numérotée sous les images est une note. Clique-la pour y aller, ou clique n'importe où sur la bande.",
  },
  {
    target: "notes",
    title: "Suivre et partager",
    body:
      "Une note corrigée se résout d'un clic. « Partager », en haut de la page, envoie la vidéo à un client sans qu'il crée de compte.",
    hint: "Rejouable par « Guide », en haut à droite",
  },
];
