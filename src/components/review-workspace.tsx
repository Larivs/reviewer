"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommentWithAuthor } from "@/lib/comments";
import { parseAnnotation, type Annotation } from "@/lib/annotation";
import { CommentsPanel } from "./comments/comments-panel";
import { useLiveComments } from "./comments/use-live-comments";
import { ShortcutsHelp } from "./player/shortcuts-help";
import { VideoPlayer, type PlayerHandle } from "./player/video-player";
import type { Marker, Range } from "./player/timeline";
import { userColor } from "@/lib/user-colors";
import type { Tool } from "./annotation/annotation-layer";

/**
 * Le lecteur publie sa position à chaque image. Répercuter ça dans l'état
 * de la page ferait rendre toute la liste de commentaires 25 à 60 fois par
 * seconde pour rien : on limite à 5 Hz. Un saut de position, lui, passe
 * immédiatement — sinon la puce du formulaire resterait en arrière après un
 * déplacement.
 */
const REFRESH_MS = 200;
const JUMP_THRESHOLD = 0.3;
/** Fenêtre autour d'une note ponctuelle pour la considérer active. */
const ACTIVE_WINDOW = 0.5;

/** La tête de lecture est-elle sur cette note ? */
function coversTime(comment: CommentWithAuthor, time: number) {
  if (comment.timecodeEnd !== null)
    return time >= comment.timecode - 0.1 && time <= comment.timecodeEnd + 0.1;
  return Math.abs(comment.timecode - time) <= ACTIVE_WINDOW;
}

type Props = {
  videoId: string;
  duration: number | null;
  fps: number | null;
  comments: CommentWithAuthor[];
  currentUserId: string;
  /** Rang de couleur du compte connecté — voir `lib/user-colors`. */
  currentUserColor: number;
};

export function ReviewWorkspace({
  videoId,
  duration,
  fps,
  comments: fromServer,
  currentUserId,
  currentUserColor,
}: Props) {
  // Les notes de Jérôme arrivent sans recharger la page. Le rendu serveur
  // fournit l'état de départ, le sondage prend le relais ensuite.
  const comments = useLiveComments(videoId, fromServer);

  const playerRef = useRef<PlayerHandle>(null);
  const lastAtRef = useRef(0);
  const lastValueRef = useRef(0);
  const [displayTime, setDisplayTime] = useState(0);
  const [tool, setTool] = useState<Tool>("none");
  const [draft, setDraft] = useState<Annotation | null>(null);
  /** La note qu'on vient d'écrire, mise en avant le temps qu'on la voie. */
  const [fresh, setFresh] = useState<string | null>(null);

  /**
   * Plage en cours de composition. Elle vit ici et non dans le formulaire
   * parce que deux endroits la manipulent : on la trace sur la piste et on
   * la relit dans le formulaire. La faire descendre depuis le haut évite de
   * synchroniser deux copies qui finissent toujours par diverger.
   */
  const [range, setRange] = useState<Range | null>(null);
  /** Le formulaire attend un glissement sur la piste. */
  const [rangeArmed, setRangeArmed] = useState(false);

  const handleTimeChange = useCallback((time: number) => {
    const now = performance.now();
    const jumped = Math.abs(time - lastValueRef.current) > JUMP_THRESHOLD;
    if (!jumped && now - lastAtRef.current < REFRESH_MS) return;
    lastAtRef.current = now;
    lastValueRef.current = time;
    setDisplayTime(time);
  }, []);

  const seekTo = useCallback((time: number) => {
    playerRef.current?.seekTo(time);
  }, []);

  // Se placer dans le champ de saisie met la vidéo en pause : on écrit une
  // note sur une image précise, pas sur une vidéo qui défile.
  const pauseForComment = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const getPreciseTime = useCallback(
    () => playerRef.current?.getCurrentTime() ?? lastValueRef.current,
    [],
  );

  /**
   * Note sous la tête de lecture. Une note de plage est active sur tout son
   * intervalle ; une note ponctuelle dans une fenêtre courte autour d'elle.
   */
  const activeId = useMemo(() => {
    // La note qu'on vient d'écrire passe devant. Sans cette priorité, une
    // note posée à l'intérieur d'une note de plage naissait sans être mise
    // en avant — la règle « la plage l'emporte » gagnait — et la sélection
    // restait sur la note ouverte juste avant : on ne voyait pas où la
    // nouvelle était partie. Elle rend la main dès qu'on quitte son
    // intervalle, la règle normale reprend.
    if (fresh) {
      const created = comments.find((c) => c.id === fresh);
      if (created && coversTime(created, displayTime)) return created.id;
    }

    let best: string | null = null;
    let bestGap = Infinity;

    for (const comment of comments) {
      if (comment.timecodeEnd !== null) {
        if (
          displayTime >= comment.timecode - 0.1 &&
          displayTime <= comment.timecodeEnd + 0.1
        ) {
          // Une plage qui contient la tête de lecture gagne toujours.
          return comment.id;
        }
        continue;
      }
      const gap = Math.abs(comment.timecode - displayTime);
      if (gap <= ACTIVE_WINDOW && gap < bestGap) {
        bestGap = gap;
        best = comment.id;
      }
    }
    return best;
  }, [comments, displayTime, fresh]);

  // On lâche la mise en avant quand la tête de lecture a quitté la note.
  //
  // Le `return` sur note absente n'est pas une précaution, c'est le cœur du
  // problème : `revalidatePath` est asynchrone, donc entre le moment où le
  // serveur rend l'identifiant et celui où la liste arrive, la note qu'on
  // vient d'écrire **n'est pas encore dans `comments`**. Cet effet tournait
  // dans cet intervalle, ne la trouvait pas, et annulait la mise en avant
  // avant même qu'elle serve — la sélection restait sur la note de plage,
  // exactement le symptôme qu'on voulait corriger. Il faut donc attendre
  // qu'elle arrive plutôt que conclure à son absence.
  //
  // Cas restant : une note supprimée juste après création laisse `fresh`
  // pointer dans le vide. C'est inerte — `activeId` exige de la trouver — et
  // la création suivante l'écrase.
  useEffect(() => {
    if (!fresh) return;
    const created = comments.find((c) => c.id === fresh);
    if (!created) return;
    if (!coversTime(created, displayTime)) setFresh(null);
  }, [fresh, comments, displayTime]);

  /** Annotation affichée sur l'image : celle de la note active. */
  const shownAnnotation = useMemo(() => {
    if (draft) return null; // le brouillon a la priorité pendant le dessin
    const active = comments.find((c) => c.id === activeId);
    return active ? parseAnnotation(active.annotation) : null;
  }, [activeId, comments, draft]);

  /**
   * Teinte des tracés. Le brouillon est à soi, donc de sa propre couleur :
   * on voit en dessinant ce que les autres verront. Une annotation existante
   * prend celle de son auteur.
   */
  const annotationColor = useMemo(() => {
    if (draft) return userColor(currentUserColor).hex;
    const active = comments.find((c) => c.id === activeId);
    return userColor(active?.authorColor).hex;
  }, [activeId, comments, draft, currentUserColor]);

  const markers = useMemo<Marker[]>(
    () =>
      comments.map((comment, i) => ({
        id: comment.id,
        time: comment.timecode,
        end: comment.timecodeEnd ?? undefined,
        index: i + 1,
        label: `#${i + 1} · ${comment.authorName} : ${comment.body.slice(0, 80)}`,
        resolved: comment.resolved,
        color: userColor(comment.authorColor).hex,
      })),
    [comments],
  );

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_352px] lg:items-start">
      <div>
        <VideoPlayer
          ref={playerRef}
          videoId={videoId}
          duration={duration}
          fps={fps}
          markers={markers}
          activeMarkerId={activeId}
          onTimeChange={handleTimeChange}
          tool={tool}
          onToolChange={setTool}
          draft={draft}
          onDraftChange={setDraft}
          shownAnnotation={shownAnnotation}
          annotationColor={annotationColor}
          range={range}
          rangeArmed={rangeArmed}
          onRangeChange={setRange}
          onRangeDone={() => setRangeArmed(false)}
        />
        <ShortcutsHelp />
      </div>

      <CommentsPanel
        videoId={videoId}
        fps={fps}
        comments={comments}
        currentUserId={currentUserId}
        currentTime={displayTime}
        activeId={activeId}
        getPreciseTime={getPreciseTime}
        onSeek={seekTo}
        onFormFocus={pauseForComment}
        freshId={fresh}
        onCreated={setFresh}
        tool={tool}
        onToolChange={setTool}
        draft={draft}
        onDraftChange={setDraft}
        range={range}
        rangeArmed={rangeArmed}
        onRangeChange={setRange}
        onRangeArmedChange={setRangeArmed}
      />
    </div>
  );
}
