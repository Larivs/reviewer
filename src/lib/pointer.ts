"use client";

/**
 * `setPointerCapture` lève si le pointeur n'est plus actif, cela arrive
 * quand le navigateur l'a déjà relâché. La capture est un confort, pas une
 * condition : son échec ne doit pas interrompre le geste.
 */
export function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Sans capture, le geste s'arrête en sortant de l'élément. Acceptable.
  }
}

export function releasePointer(element: Element, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // Idem : rien à faire si la capture n'existe plus.
  }
}
