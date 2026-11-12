import type { TourStep } from "./tour";

/**
 * Deux tours plutôt qu'un seul long : la page des projets et l'espace de
 * review. Chacun se lance au premier passage sur sa page, donc l'explication
 * arrive au moment où elle sert. Tout expliquer d'un bloc à la connexion,
 * c'est faire retenir dix choses dont neuf ne servent que dans dix minutes.
 *
 * Les libellés parlent du métier, pas de l'interface : « déposer les rushes »
 * plutôt que « zone de dépôt de fichiers ».
 */
export const PROJECTS_TOUR: TourStep[] = [
  {
    title: "Bienvenue",
    body:
      "Reviewer sert à commenter une vidéo à l'image près, entre vous, sans rien envoyer dehors. Une minute pour faire le tour, et on ne te le repropose plus.",
  },
  {
    target: "upload",
    title: "Déposer les rushes",
    body:
      "Glisse tes fichiers ici, ou clique pour les choisir. En MP4 H.264 : le ProRes et le DNxHD sont à réexporter, aucun navigateur ne sait les lire.",
  },
  {
    target: "new-folder",
    title: "Ranger",
    body:
      "Un dossier par client ou par projet, et ils s'imbriquent. Rien n'est définitif : une vidéo se déplace après coup.",
  },
  {
    target: "video-card",
    title: "La vignette",
    body:
      "Le statut se change ici, sans ouvrir la vidéo. La pastille bleue en haut à gauche de l'image compte les notes encore ouvertes, c'est ce qu'on regarde en arrivant.",
  },
  {
    target: "video-actions",
    title: "Déplacer, renommer, supprimer",
    body:
      "Ces trois boutons sont sur chaque vignette, en retrait tant qu'on ne s'en approche pas. Le deuxième envoie la vidéo dans un autre dossier.",
    // Justement : sans ça le halo encadrerait trois boutons invisibles.
    reveal: true,
  },
  {
    title: "À toi",
    body:
      "Clique une vignette pour ouvrir la review. Un second guide s'y lancera, sur place.",
    hint: "Rejouable par « Guide », en haut à droite",
  },
];

export const REVIEW_TOUR: TourStep[] = [
  {
    target: "notes",
    title: "Le panneau de notes",
    body:
      "Tout se joue à droite : on écrit, on relit, on marque résolu. Chaque note porte un numéro, donc « la note 3 » désigne la même chose pour tout le monde, y compris au téléphone.",
  },
  {
    target: "note-form",
    title: "Écrire au timecode",
    body:
      "Place-toi sur l'image, puis écris. Le timecode se fige à la première frappe : le temps de rédiger, la vidéo peut avancer sans emporter ta note. « Plage » arme la piste : un glissement dessus couvre un intervalle au lieu d'un instant, et l'image suit pendant le geste.",
    hint: "Ctrl + Entrée pour envoyer",
  },
  {
    target: "annotate",
    title: "Dessiner sur l'image",
    body:
      "Point, flèche, cadre ou tracé libre, attachés à la note et rejoués à son timecode. Utile quand « ce truc en haut à droite » demanderait trois phrases.",
  },
  {
    target: "timeline",
    title: "La piste",
    body:
      "Clique n'importe où pour y aller, survole pour voir l'image avant d'y sauter. En approchant d'une note, la tête de lecture se cale exactement dessus. Les repères sous la piste sont les notes, à la couleur de leur auteur.",
    hint: "Alt en cliquant pour viser au pixel",
  },
  {
    target: "shortcuts",
    title: "Le clavier",
    body:
      "Les flèches avancent d'une image, Maj les fait sauter d'une seconde. C'est là qu'on gagne du temps sur une review longue, la liste complète reste dépliable.",
  },
];
