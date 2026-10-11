import { useEffect, useState, type RefObject } from "react";
import { formatHeardLength, planLibraryAudio, supportsOggVorbis } from "../lib/assets/preview-audio";
import { text } from "./text";

/**
 * Detail player for one library sound.
 * The native control stays, and a text length sits under it: sub-second
 * sounds otherwise look like 0:00 / 0:00. Safari, which cannot play OGG,
 * is handed the PCM preview instead.
 */
export function LibraryPlayer({
  sourceUrl,
  fallbackUrl,
  mediaType,
  playerRef,
  onPlayState,
}: {
  sourceUrl: string;
  fallbackUrl: string | null;
  mediaType: string;
  playerRef: RefObject<HTMLAudioElement | null>;
  onPlayState: (playing: boolean) => void;
}) {
  const [canOgg, setCanOgg] = useState(true);
  const [forceFallback, setForceFallback] = useState(false);
  const [heard, setHeard] = useState<number | null>(null);
  const [track, setTrack] = useState(sourceUrl);
  if (track !== sourceUrl) {
    setTrack(sourceUrl);
    setHeard(null);
    setForceFallback(false);
  }

  useEffect(() => {
    const probe = document.createElement("audio");
    setCanOgg(supportsOggVorbis((mime) => probe.canPlayType(mime)));
  }, []);

  const plan = planLibraryAudio({
    mediaType,
    sourceUrl,
    fallbackUrl,
    canPlayOgg: canOgg && !forceFallback,
  });
  const length = heard === null ? null : formatHeardLength(heard);

  if (!sourceUrl) return <p data-testid="library-audio-duration">{text.library.preparing}</p>;

  return (
    <div className="library-player" data-testid="library-player">
      {plan.src ? (
        <audio
          key={plan.src}
          ref={playerRef}
          controls
          preload="metadata"
          src={plan.src}
          data-testid="library-preview"
          data-preview={plan.usingFallback ? "wav" : "original"}
          onLoadedMetadata={(event) => setHeard(event.currentTarget.duration)}
          onPlay={() => onPlayState(true)}
          onPause={() => onPlayState(false)}
          onEnded={() => onPlayState(false)}
          onError={() => {
            if (fallbackUrl && !forceFallback && !plan.usingFallback) {
              setForceFallback(true);
              setHeard(null);
              return;
            }
            setHeard(null);
          }}
        />
      ) : null}
      <p data-testid="library-audio-duration">{length ? text.library.duration(length) : text.library.durationPending}</p>
      {plan.usingFallback ? <p data-testid="library-audio-unsupported">{text.library.oggPreview}</p> : null}
      {plan.blocked ? <p data-testid="library-audio-unsupported">{text.library.oggBlocked}</p> : null}
    </div>
  );
}
