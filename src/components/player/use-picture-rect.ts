"use client";

import { useCallback, useEffect, useState } from "react";

export type PictureRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Rectangle réellement occupé par l'image dans l'élément vidéo. Un
 * `<video>` centre son image et laisse des bandes noires dès que le cadre
 * de l'élément n'a pas le même rapport. Tout ce qui se superpose à l'image
 *, annotations, repères de recadrage, doit se caler sur ce rectangle et
 * non sur la boîte de l'élément, sinon ça atterrit dans les bandes.
 */
export function usePictureRect(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [rect, setRect] = useState<PictureRect | null>(null);

  const measure = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const boxW = video.clientWidth;
    const boxH = video.clientHeight;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!boxW || !boxH) return;

    // Avant les métadonnées, on n'a pas les dimensions natives : on couvre
    // toute la boîte plutôt que de ne rien afficher.
    if (!vw || !vh) {
      setRect({ left: 0, top: 0, width: boxW, height: boxH });
      return;
    }

    const scale = Math.min(boxW / vw, boxH / vh);
    const width = vw * scale;
    const height = vh * scale;
    setRect({
      left: (boxW - width) / 2,
      top: (boxH - height) / 2,
      width,
      height,
    });
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(video);
    video.addEventListener("loadedmetadata", measure);

    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", measure);
    };
  }, [measure, videoRef]);

  return rect;
}
