// Partagé client et serveur : pas de garde "server-only".

/**
 * Couleur d'identité d'un utilisateur.
 *
 * C'est un **axe distinct de l'accent**. La règle de la palette — « l'accent
 * signale ce qui est actif ou attend une action, il ne décore pas » — tient
 * toujours : ces teintes ne signalent rien, elles disent *qui*.
 *
 * **Sourdes, et à valeur égale.** La première version tapait dans les teintes
 * web à pleine saturation — citron, fuchsia, corail. Chroma moyenne mesurée :
 * 61. Sur une interface qui vient justement de se calmer, une liste de notes
 * ressemblait à un paquet de bonbons, et la couleur d'identité criait plus
 * fort que l'accent, qui est pourtant le seul signal de l'écran. Ici la
 * chroma moyenne est de 24 : on reconnaît l'auteur, on ne le subit pas.
 *
 * **Quatre, et pas cinq.** C'est le plafond honnête à ce niveau de chroma, et
 * il est mesuré, pas estimé. Les quatre retenues s'écartent entre elles d'au
 * moins ΔE 24 et d'au moins ΔE 33 de toute couleur du système. Aucune
 * cinquième candidate ne tient les deux : un sable ou une olive retombent à
 * ΔE 12-18 d'une voisine, une ardoise ou un bleu-gris à ΔE 3-6 du gris de
 * texte `--color-muted` — un auteur qui aurait l'air désactivé.
 *
 * Au cinquième compte, les couleurs recyclent donc : deux personnes
 * partagent une teinte, et ce sont l'initiale et le prénom qui les séparent.
 * C'est le bon compromis — répéter une couleur sobre vaut mieux qu'en
 * inventer une qui ment sur ce qu'elle désigne.
 */
export type UserColor = {
  /** Teinte principale : texte, traits, repères. */
  hex: string;
  /** Nom lisible, pour les infobulles. */
  label: string;
};

export const USER_COLORS: UserColor[] = [
  { hex: "#c2896b", label: "terre cuite" },
  { hex: "#a5849f", label: "prune" },
  { hex: "#6fa5a8", label: "céladon" },
  { hex: "#8fa882", label: "sauge" },
];

/**
 * Index → teinte, avec repli sur la première. L'index vient du serveur
 * (rang d'ancienneté du compte) : deux personnes n'ont jamais la même
 * couleur tant que l'équipe tient dans la palette.
 */
export function userColor(index: number | null | undefined): UserColor {
  if (index == null || !Number.isFinite(index)) return USER_COLORS[0];
  return USER_COLORS[((index % USER_COLORS.length) + USER_COLORS.length) % USER_COLORS.length];
}

/**
 * Initiales affichées dans la pastille. Une seule lettre : à 16 px, deux
 * lettres deviennent un pâté, et trois personnes se distinguent déjà par la
 * couleur — la lettre n'est que le filet de sécurité pour qui distingue mal
 * les teintes.
 */
export function userInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}
