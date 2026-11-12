import type { MetadataRoute } from "next";

/**
 * Manifeste d'application web : ce qui permet « Ajouter à l'écran d'accueil »
 * sur un téléphone, avec sa propre icône et sans la barre du navigateur.
 *
 * Ce n'est pas une application native, et il n'y en a pas : une instance vit
 * à une adresse que chaque studio choisit, une application de magasin ne
 * saurait pas où se connecter. L'app web installée fait le même travail.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Reviewer",
    short_name: "Reviewer",
    description: "Review vidéo au timecode",
    start_url: "/",
    display: "standalone",
    background_color: "#07090e",
    theme_color: "#07090e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
