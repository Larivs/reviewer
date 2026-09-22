/**
 * Fond des pages de navigation : une seule nappe bleue, fixe.
 *
 * Ce qu'il y avait avant, une photo de faisceau de projection en
 * `mix-blend-mode: screen`, un vignettage, et deux nappes chaudes qui
 * dérivaient sur des cycles de 97 et 133 secondes, racontait une salle de
 * projection. C'était la pièce la plus datée de l'interface, et la plus
 * chère : 40 Ko d'image et trois animations permanentes derrière une grille
 * de vignettes qu'on est en train de lire.
 *
 * Il en reste la seule chose qui servait vraiment : un peu de profondeur
 * dans les angles, pour que le fond ne soit pas un aplat mort. Froide, pour
 * ne pas mentir sur les images posées dessus.
 *
 * Volontairement absente de la page de review : le lecteur a besoin d'un
 * noir neutre pour qu'on puisse juger un étalonnage, et toute dominante dans
 * le champ de vision fausserait ce jugement.
 */
export function Ambience() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="ambience-cool" />

      {/* Vignettage : il assombrit les bords et concentre l'œil au centre,
          là où sont les cartes. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(120% 95% at 50% 28%, transparent 42%, rgb(7 9 14 / 0.75) 100%)",
        }}
      />
    </div>
  );
}
