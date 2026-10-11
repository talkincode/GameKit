import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { displayFrame } from "../lib/pixel/film";
import type { FilmSession } from "../lib/pixel/film";
import { text } from "./text";

const PRESETS = [
  { id: "idle", label: text.pixel.anim.stateIdle },
  { id: "walk", label: text.pixel.anim.stateWalk },
  { id: "jump", label: text.pixel.anim.stateJump },
] as const;

/** Timeline, actions, and layers. The film itself stays in the editor. */
export function PixelAnimPanel({
  film,
  revision,
  onion,
  playing,
  playFrame,
  onToggleOnion,
  onTogglePlay,
  onAddFrame,
  onCopyFrame,
  onDeleteFrame,
  onSelectFrame,
  onDuration,
  onFps,
  onToggleState,
  onAddLayer,
  onDeleteLayer,
  onMoveLayer,
  onSelectLayer,
  onToggleLayer,
  onImport,
}: {
  film: FilmSession;
  revision: number;
  onion: boolean;
  playing: boolean;
  playFrame: number;
  onToggleOnion: () => void;
  onTogglePlay: () => void;
  onAddFrame: () => void;
  onCopyFrame: () => void;
  onDeleteFrame: () => void;
  onSelectFrame: (index: number) => void;
  onDuration: (ms: number) => void;
  onFps: (fps: number) => void;
  onToggleState: (name: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: () => void;
  onMoveLayer: (direction: -1 | 1) => void;
  onSelectLayer: (index: number) => void;
  onToggleLayer: (index: number, visible: boolean) => void;
  onImport: () => void;
}) {
  const thumbs = useRef<(HTMLCanvasElement | null)[]>([]);
  const frame = film.frames[film.index];
  const [duration, setDuration] = useState(String(frame?.durationMs ?? ""));

  useEffect(() => {
    setDuration(String(film.frames[film.index]?.durationMs ?? ""));
  }, [film, film.index, frame?.durationMs, revision]);

  useLayoutEffect(() => {
    film.frames.forEach((_, index) => {
      const canvas = thumbs.current[index];
      if (!canvas) return;
      const pixels = displayFrame(film, index, false);
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      const copy = new Uint8ClampedArray(pixels.data);
      canvas.getContext("2d")?.putImageData(new ImageData(copy, pixels.width, pixels.height), 0, 0);
    });
  }, [film, revision, film.frames.length, film.index]);

  const commitDuration = () => {
    const value = Number(duration);
    if (Number.isInteger(value)) onDuration(value);
    else setDuration(String(frame?.durationMs ?? ""));
  };

  return (
    <section className="pixel-anim" data-testid="pixel-anim" aria-label={text.pixel.anim.frames}>
      <div className="pixel-anim-row">
        <div className="pixel-frames" role="list">
          {film.frames.map((_, index) => (
            <button
              key={index}
              type="button"
              role="listitem"
              className={`pixel-frame${film.index === index ? " on" : ""}`}
              aria-pressed={film.index === index}
              aria-label={text.pixel.anim.frameLabel(index)}
              data-testid={`pixel-frame-${index}`}
              data-playing={playing && playFrame === index ? "true" : "false"}
              onClick={() => onSelectFrame(index)}
            >
              <canvas ref={(node) => { thumbs.current[index] = node; }} aria-hidden="true" />
              <span>{index + 1}</span>
            </button>
          ))}
        </div>
        <button type="button" data-testid="pixel-add-frame" title={text.pixel.anim.addFrameHint} onClick={onAddFrame}>
          {text.pixel.anim.addFrame}
        </button>
        <button type="button" data-testid="pixel-copy-frame" onClick={onCopyFrame}>
          {text.pixel.anim.copyFrame}
        </button>
        <button type="button" data-testid="pixel-delete-frame" onClick={onDeleteFrame}>
          {text.pixel.anim.deleteFrame}
        </button>
        <label className="pixel-duration">
          <span>{text.pixel.anim.duration}</span>
          <input
            inputMode="numeric"
            value={duration}
            data-testid="pixel-frame-duration"
            aria-label={text.pixel.anim.duration}
            onChange={(event) => setDuration(event.target.value)}
            onBlur={commitDuration}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDuration();
              }
            }}
          />
          <span>{text.pixel.anim.durationUnit}</span>
        </label>
        <span className="pixel-fps" role="group" aria-label={text.pixel.anim.fps}>
          <span>{text.pixel.anim.fps}</span>
          {[4, 8, 12].map((fps) => (
            <button key={fps} type="button" data-testid={`pixel-fps-${fps}`} onClick={() => onFps(fps)}>
              {fps}
            </button>
          ))}
        </span>
        <label className="pixel-grid-toggle">
          <input type="checkbox" checked={onion} data-testid="pixel-onion" onChange={onToggleOnion} />
          <span title={text.pixel.anim.onionHint}>{text.pixel.anim.onion}</span>
        </label>
        <button type="button" data-testid="pixel-play" aria-pressed={playing} onClick={onTogglePlay}>
          {playing ? text.pixel.anim.pause : text.pixel.anim.play}
        </button>
      </div>

      <div className="pixel-anim-row">
        <span className="pixel-anim-label">{text.pixel.anim.state}</span>
        {PRESETS.map((preset) => {
          const indices = film.states[preset.id] ?? [];
          const line = indices.map((index) => index + 1).join(" → ");
          return (
            <button
              key={preset.id}
              type="button"
              data-testid={`pixel-state-${preset.id}`}
              aria-pressed={indices.includes(film.index)}
              title={text.pixel.anim.stateHint}
              onClick={() => onToggleState(preset.id)}
            >
              {text.pixel.anim.stateLine(preset.label, line)}
            </button>
          );
        })}
        <span className="pixel-anim-label">{text.pixel.anim.layers}</span>
        {frame?.layers.map((layer, index) => (
          <span key={`${layer.name}-${index}`} className="pixel-layer">
            <button
              type="button"
              className={film.layer === index ? "on" : ""}
              aria-pressed={film.layer === index}
              data-testid={`pixel-layer-${index}`}
              onClick={() => onSelectLayer(index)}
            >
              {layer.name}
            </button>
            <input
              type="checkbox"
              checked={layer.visible}
              data-testid={`pixel-layer-visible-${index}`}
              aria-label={layer.name}
              onChange={(event) => onToggleLayer(index, event.target.checked)}
            />
          </span>
        ))}
        <button type="button" data-testid="pixel-add-layer" onClick={onAddLayer}>
          {text.pixel.anim.addLayer}
        </button>
        <button type="button" data-testid="pixel-delete-layer" onClick={onDeleteLayer}>
          {text.pixel.anim.deleteLayer}
        </button>
        <button type="button" data-testid="pixel-layer-up" onClick={() => onMoveLayer(1)}>
          {text.pixel.anim.layerUp}
        </button>
        <button type="button" data-testid="pixel-layer-down" onClick={() => onMoveLayer(-1)}>
          {text.pixel.anim.layerDown}
        </button>
        <button type="button" data-testid="pixel-import-sheet" onClick={onImport}>
          {text.pixel.anim.importSheet}
        </button>
      </div>
    </section>
  );
}
