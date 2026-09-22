import { userColor, userInitial } from "@/lib/user-colors";

/**
 * Pastille d'identité : l'initiale sur la teinte de la personne.
 *
 * Trois signaux redondants plutôt qu'un seul, la teinte, l'initiale, et le
 * nom quand la place le permet. La couleur seule exclurait qui distingue mal
 * les teintes, et à trois personnes dont deux prénoms commencent par la même
 * lettre, l'initiale seule ne suffirait pas non plus.
 */
export function UserChip({
  name,
  colorIndex,
  withName = false,
  size = "sm",
  shrink = true,
}: {
  name: string;
  colorIndex: number;
  /** Ajoute le prénom à droite de la pastille. */
  withName?: boolean;
  size?: "sm" | "md";
  /**
   * Autorise la troncature du nom quand la ligne est trop étroite. À couper
   * dans une ligne qui peut revenir à la ligne : un prénom réduit à son
   * initiale suivie de points de suspension ne désigne plus personne, et
   * c'est précisément l'information qu'on met une couleur à porter.
   */
  shrink?: boolean;
}) {
  const { hex, label } = userColor(colorIndex);
  const box = size === "md" ? "size-5 text-[10px]" : "size-4 text-[9px]";

  return (
    <span
      className={`flex items-center gap-1.5 ${shrink ? "min-w-0" : "shrink-0"}`}
      title={`${name}, ${label}`}
    >
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-full border font-mono font-medium leading-none ${box}`}
        style={{
          color: hex,
          borderColor: `color-mix(in srgb, ${hex} 55%, transparent)`,
          background: `color-mix(in srgb, ${hex} 16%, transparent)`,
        }}
      >
        {userInitial(name)}
      </span>
      {withName && (
        <span
          className={`text-xs font-medium ${shrink ? "truncate" : ""}`}
          style={{ color: hex }}
        >
          {name}
        </span>
      )}
      {!withName && <span className="sr-only">{name}</span>}
    </span>
  );
}
