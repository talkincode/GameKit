import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  DEFAULT_DURATION_MS,
  animationSidecarPath,
  framesFromDocument,
  parseSpriteAnim,
  playOrder,
  pygameAnimDemo,
  pygameAnimModule,
  pygameAnimSnippet,
  stepPlay,
  type PlayCursor,
} from "../lib/pixel/anim";
import { type Pixels, type Rgba, TRANSPARENT, parseHex, toHex } from "../lib/pixel/buffer";
import {
  type FilmLimit,
  type FilmSession,
  type FilmTool,
  addBlankFrame,
  addLayer,
  clearActiveLayer,
  createFilm,
  deleteFrame,
  deleteLayer,
  displayFrame,
  duplicateFrame,
  exportFilm,
  filmCanRedo,
  filmCanUndo,
  filmDirty,
  filmFromImage,
  filmFromSaved,
  filmMarkSaved,
  filmPointerDown,
  filmPointerMove,
  filmPointerUp,
  filmRedo,
  filmUndo,
  moveLayer,
  replaceWithSheet,
  selectFrame,
  selectLayer,
  setFps,
  setFrameDuration,
  setLayerVisible,
  toggleStateFrame,
} from "../lib/pixel/film";
import { loadPixels } from "../lib/pixel/load";
import { PALETTE } from "../lib/pixel/palette";
import { encodePng } from "../lib/pixel/png";
import { boardBudget, imagePath, startZoom, stepZoom } from "../lib/pixel/rules";
import { uniquePath } from "../lib/project";
import { type PixelSession, useStudio } from "../studio/store";
import { PixelAnimPanel } from "./PixelAnimPanel";
import { PixelSwatches } from "./PixelSwatches";
import { text } from "./text";
import "./pixel-editor.css";

type Loaded =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; film: FilmSession; animProblem: string };

/** The editor is mounted whenever a session is open; a new session is a fresh editor. */
export function PixelEditor() {
  const studio = useStudio();
  const open = studio.pixelSession;
  return open ? <PixelEditorFor key={open.id} open={open} /> : null;
}

function PixelEditorFor({ open }: { open: PixelSession }) {
  const studio = useStudio();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    let cancel = false;
    if (open.source === "new") {
      const fill = open.background ? (parseHex(open.background) ?? TRANSPARENT) : TRANSPARENT;
      setLoaded({ status: "ready", film: createFilm(open.width, open.height, fill), animProblem: "" });
      return;
    }
    void loadPixels(open.bytes).then((result) => {
      if (cancel) return;
      if (!result.ok) {
        setLoaded({ status: "error", message: result.problem === "too-big" ? text.pixel.tooBig : text.pixel.unreadable });
        return;
      }
      const note = open.source === "file" ? open.animText : null;
      if (!note) {
        setLoaded({ status: "ready", film: filmFromImage(result.pixels), animProblem: "" });
        return;
      }
      const parsed = parseSpriteAnim(note, open.path);
      const frames = parsed.ok ? framesFromDocument(result.pixels, parsed.document) : null;
      const film = frames
        ? filmFromSaved(frames, {
            durations: parsed.ok ? parsed.document.animation.frames.map((frame) => frame.durationMs) : [],
            names: parsed.ok ? parsed.document.animation.frames.map((frame) => frame.name) : [],
            states: parsed.ok ? (parsed.document.animation.states ?? {}) : {},
          })
        : null;
      // A bad note does not change the file. The picture opens whole, and the child is told.
      setLoaded({
        status: "ready",
        film: film ?? filmFromImage(result.pixels),
        animProblem: film ? "" : text.pixel.anim.unread,
      });
    });
    return () => {
      cancel = true;
    };
  }, [open]);

  if (loaded.status === "ready") return <Workspace open={open} film={loaded.film} animProblem={loaded.animProblem} />;
  return (
    <div className="modal-back" role="presentation">
      <div className="modal pixel-note" role="dialog" aria-modal="true" data-testid="pixel-editor-loading" aria-label={text.pixel.title}>
        <p role={loaded.status === "error" ? "alert" : "status"}>{loaded.status === "error" ? loaded.message : text.pixel.loading}</p>
        <div className="modal-actions">
          <button type="button" onClick={studio.closePixelEditor}>
            {text.pixel.close}
          </button>
        </div>
      </div>
    </div>
  );
}

function colorName(color: Rgba): string {
  if (color[3] === 0) return text.pixel.transparentColor;
  const hex = toHex(color);
  return text.pixel.colors[hex] ?? text.pixel.customName(hex);
}

function limitText(reason: FilmLimit): string {
  switch (reason) {
    case "frames":
      return text.pixel.anim.limitFrames;
    case "pixels":
      return text.pixel.anim.limitPixels;
    case "layers":
      return text.pixel.anim.limitLayers;
    case "last-frame":
      return text.pixel.anim.limitLastFrame;
    case "last-layer":
      return text.pixel.anim.limitLast;
    case "fit":
      return text.pixel.anim.sheetBad;
    case "size":
      return text.pixel.anim.sheetSize;
    default:
      return text.pixel.anim.sheetMany;
  }
}

type SavePrompt = null | "close" | "save-as" | "sheet" | "demo";

function Workspace({ open, film, animProblem }: { open: PixelSession; film: FilmSession; animProblem: string }) {
  const studio = useStudio();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const activePointer = useRef<number | null>(null);
  const busy = useRef(false);
  const playingRef = useRef(false);
  const playFrameRef = useRef(0);
  const onionRef = useRef(false);
  const playRef = useRef<PlayCursor>({ order: [0], cursor: 0, into: 0 });
  const [revision, bump] = useReducer((count: number) => count + 1, 0);
  const [tool, setTool] = useState<FilmTool>("pencil");
  const [color, setColor] = useState<Rgba>(() => parseHex(PALETTE[0]) as Rgba);
  const [grid, setGrid] = useState(true);
  const [onion, setOnion] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playFrame, setPlayFrame] = useState(0);
  const [scale, setScale] = useState(() => {
    const box = boardBudget(window.innerWidth, window.innerHeight);
    return startZoom(film.width, film.height, box.width, box.height);
  });
  const [target, setTarget] = useState({ path: open.path, mode: open.source === "file" ? ("overwrite" as const) : ("create" as const) });
  const [prompt, setPrompt] = useState<SavePrompt>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [limit, setLimit] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [exampleNote, setExampleNote] = useState("");
  const [saveAsName, setSaveAsName] = useState("");
  const [sheet, setSheet] = useState<{ pixels: Pixels; frameWidth: string; frameHeight: string } | null>(null);

  playingRef.current = playing;
  playFrameRef.current = playFrame;
  onionRef.current = onion;

  const paint = useCallback(() => {
    const index = playingRef.current ? playFrameRef.current : film.index;
    const shown = displayFrame(film, index, onionRef.current && !playingRef.current);
    const image = new ImageData(new Uint8ClampedArray(shown.data), shown.width, shown.height);
    for (const ref of [canvasRef, previewRef]) ref.current?.getContext("2d")?.putImageData(image, 0, 0);
  }, [film]);
  useLayoutEffect(paint, [paint, revision, playing, playFrame, onion, film.width, film.height]);

  useEffect(() => {
    const box = boardBudget(window.innerWidth, window.innerHeight);
    setScale(startZoom(film.width, film.height, box.width, box.height));
  }, [film.width, film.height]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let handle = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      playRef.current = stepPlay(
        playRef.current,
        dt,
        film.frames.map((frame) => frame.durationMs),
      );
      setPlayFrame(playRef.current.order[playRef.current.cursor] ?? 0);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, film]);

  const paths = useMemo(() => studio.project?.files.map((file) => file.path) ?? [], [studio.project]);
  const dirty = filmDirty(film);
  const sidePath = animationSidecarPath(target.path);
  const animated =
    film.frames.length > 1 ||
    Object.keys(film.states).length > 0 ||
    film.frames.some((frame) => frame.durationMs !== DEFAULT_DURATION_MS || !!frame.name || frame.layers.length > 1);
  const onDisk = !dirty && !!sidePath && paths.includes(target.path) && paths.includes(sidePath);

  const noteLimit = (result: true | FilmLimit) => {
    setPlaying(false);
    setLimit(result === true ? "" : limitText(result));
    bump();
  };

  const requestClose = () => {
    if (busy.current) return;
    filmPointerUp(film);
    if (filmDirty(film)) setPrompt("close");
    else studio.closePixelEditor();
  };

  /** Writes the picture and, when it is an animation, the note. A failure leaves both unwritten. */
  const save = async (to: { path: string; mode: "create" | "overwrite" }): Promise<boolean> => {
    if (busy.current) return false;
    setPlaying(false);
    filmPointerUp(film);
    const built = exportFilm(film, to.path);
    if (!built) {
      setProblem(text.pixel.failed["bad-anim"]);
      return false;
    }
    const sidecarPath = animationSidecarPath(to.path);
    const sidecarThere = to.mode === "overwrite" && !!sidecarPath && paths.includes(sidecarPath);
    const writeNote = !!sidecarPath && (animated || sidecarThere || film.frames.length > 1);
    busy.current = true;
    setSaving(true);
    setProblem("");
    const result = await studio.savePixelImage({
      path: to.path,
      bytes: encodePng(built.sheet),
      mode: to.mode,
      sidecar: writeNote && sidecarPath ? { path: sidecarPath, text: built.json } : undefined,
    });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setProblem(text.pixel.failed[result.reason]);
      return false;
    }
    filmMarkSaved(film);
    setTarget({ path: result.path, mode: "overwrite" });
    setSavedPath(result.path);
    bump();
    return true;
  };

  const doUndo = () => {
    if (busy.current) return;
    setPlaying(false);
    if (filmUndo(film)) {
      paint();
      bump();
    }
  };
  const doRedo = () => {
    if (busy.current) return;
    setPlaying(false);
    if (filmRedo(film)) {
      paint();
      bump();
    }
  };

  const latest = useRef({ doUndo, doRedo, requestClose, prompt });
  latest.current = { doUndo, doRedo, requestClose, prompt };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest?.(
        'input:not([type="color"]):not([type="checkbox"]):not([type="button"]), textarea, [contenteditable="true"]',
      );
      if (event.key === "Escape") {
        event.preventDefault();
        if (latest.current.prompt) setPrompt(null);
        else latest.current.requestClose();
        return;
      }
      if (typing || latest.current.prompt) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) latest.current.doRedo();
        else latest.current.doUndo();
      } else if (mod && key === "y") {
        event.preventDefault();
        latest.current.doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!filmDirty(film)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [film]);

  const cellOf = (clientX: number, clientY: number): [number, number] => {
    const rect = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    return [
      Math.floor(((clientX - rect.left) * film.width) / rect.width),
      Math.floor(((clientY - rect.top) * film.height) / rect.height),
    ];
  };

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy.current || playingRef.current) return;
    if (activePointer.current !== null) {
      if (!event.isPrimary) return;
      filmPointerUp(film);
      activePointer.current = null;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; drawing still works while it is over the board.
    }
    activePointer.current = event.pointerId;
    const [x, y] = cellOf(event.clientX, event.clientY);
    const result = filmPointerDown(film, tool, x, y, color);
    if (result.picked) {
      setColor(result.picked);
      setTool("pencil");
    }
    paint();
  };

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointer.current) return;
    const native = event.nativeEvent;
    const steps = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    for (const step of steps.length ? steps : [native]) {
      const [x, y] = cellOf(step.clientX, step.clientY);
      filmPointerMove(film, tool, x, y, color);
    }
    paint();
    if (tool === "select") bump();
  };

  const onUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointer.current) return;
    activePointer.current = null;
    filmPointerUp(film);
    paint();
    bump();
  };

  const toolButton = (id: FilmTool, label: string, hint: string, icon: string) => (
    <button
      type="button"
      className={`pixel-tool${tool === id ? " on" : ""}`}
      aria-label={label}
      aria-pressed={tool === id}
      title={hint}
      data-testid={`pixel-tool-${id}`}
      onClick={() => {
        setPlaying(false);
        setTool(id);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={icon} />
      </svg>
      <span>{label}</span>
    </button>
  );

  const swatchValue = color[3] === 0 ? null : toHex(color);
  const board = { width: film.width * scale, height: film.height * scale };
  const cell = scale * Math.max(1, Math.round(8 / scale));
  const saveLabel = saving ? text.pixel.saving : text.pixel.save;
  const askName = saveAsName.trim() ? imagePath(saveAsName) : null;
  const askTaken = askName !== null && paths.includes(askName);
  const hidden = film.frames[film.index]?.layers[film.layer]?.visible === false;
  const shownFrame = playing ? playFrame : film.index;

  const putExample = async (mainText?: string) => {
    if (busy.current || !sidePath) return;
    busy.current = true;
    setSaving(true);
    setProblem("");
    const result = await studio.saveAnimExample({
      moduleText: pygameAnimModule(),
      mainText,
    });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setProblem(text.pixel.failed[result.reason === "bad-path" ? "bad-path" : result.reason === "no-project" ? "no-project" : "write-failed"]);
      return;
    }
    if (result.module === "wrote") setExampleNote(text.pixel.anim.moduleWrote);
    else if (result.module === "kept") setExampleNote(text.pixel.anim.moduleKept);
    else setExampleNote(text.pixel.anim.moduleSame);
    if (mainText && result.main) setPrompt(null);
  };

  return (
    <div className="modal-back" role="presentation">
      <div
        ref={rootRef}
        tabIndex={-1}
        className="modal pixel-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pixel-editor-title"
        data-testid="pixel-editor"
        data-dirty={dirty}
      >
        <header className="pixel-head">
          <h2 id="pixel-editor-title" data-testid="pixel-title">
            {text.pixel.titleFor(target.path, film.width, film.height)}
          </h2>
          {dirty ? <span className="pixel-dirty">{text.pixel.dirty}</span> : null}
          <button type="button" onClick={requestClose} data-testid="pixel-close">
            {text.pixel.close}
          </button>
        </header>

        <div className="pixel-body">
          <aside className="pixel-tools" aria-label={text.pixel.tools}>
            <div className="pixel-tool-row" role="group" aria-label={text.pixel.tools}>
              {toolButton("pencil", text.pixel.pencil, text.pixel.pencilHint, "M4 20l1-5L16 4l4 4L9 19zM14 6l4 4")}
              {toolButton("eraser", text.pixel.eraser, text.pixel.eraserHint, "M4 16l9-10 7 6-6 8H8zM9 20h11")}
              {toolButton("fill", text.pixel.fill, text.pixel.fillHint, "M5 12l7-7 7 7-7 7zM19 15c1 2 1.5 3 0 4s-3 0-2-4")}
              {toolButton("picker", text.pixel.picker, text.pixel.pickerHint, "M14 4l6 6-3 1-8 8H5v-4l8-8zM13 7l4 4")}
              {toolButton("select", text.pixel.anim.select, text.pixel.anim.selectHint, "M5 5h14v14H5z")}
            </div>
            <div className="pixel-tool-row">
              <button
                type="button"
                aria-label={text.pixel.undo}
                title={`${text.pixel.undo} (Ctrl/⌘+Z)`}
                aria-keyshortcuts="Control+Z Meta+Z"
                data-testid="pixel-undo"
                disabled={!filmCanUndo(film)}
                onClick={doUndo}
              >
                {text.pixel.undo}
              </button>
              <button
                type="button"
                aria-label={text.pixel.redo}
                title={`${text.pixel.redo} (Ctrl/⌘+Shift+Z)`}
                aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
                data-testid="pixel-redo"
                disabled={!filmCanRedo(film)}
                onClick={doRedo}
              >
                {text.pixel.redo}
              </button>
              <button
                type="button"
                aria-label={text.pixel.clear}
                title={text.pixel.clearHint}
                data-testid="pixel-clear"
                onClick={() => {
                  if (busy.current) return;
                  setPlaying(false);
                  if (clearActiveLayer(film)) {
                    paint();
                    bump();
                  }
                }}
              >
                {text.pixel.clear}
              </button>
            </div>

            <PixelSwatches
              label={text.pixel.palette}
              value={swatchValue}
              transparent
              onPick={(hex) => setColor(hex ? (parseHex(hex) as Rgba) : TRANSPARENT)}
            />
            <div className="pixel-current-row">
              <span
                className={`pixel-current${color[3] === 0 ? " clear" : ""}`}
                style={color[3] === 0 ? undefined : { background: toHex(color) }}
                role="img"
                aria-label={text.pixel.currentIs(colorName(color))}
                data-testid="pixel-color"
                data-hex={swatchValue ?? "transparent"}
              />
              <span className="pixel-current-name">
                <small>{text.pixel.current}</small>
                {colorName(color)}
              </span>
              <label className="pixel-custom">
                <span className="visually-hidden">{text.pixel.custom}</span>
                <input
                  type="color"
                  aria-label={text.pixel.custom}
                  title={text.pixel.custom}
                  data-testid="pixel-custom-color"
                  value={swatchValue ?? "#000000"}
                  onChange={(event) => {
                    const next = parseHex(event.target.value);
                    if (next) setColor(next);
                  }}
                />
              </label>
            </div>

            <div className="pixel-view-row">
              <label className="pixel-grid-toggle">
                <input
                  type="checkbox"
                  checked={grid}
                  data-testid="pixel-grid-toggle"
                  onChange={(event) => setGrid(event.target.checked)}
                />
                <span>{text.pixel.grid}</span>
              </label>
              <span className="pixel-zoom" role="group" aria-label={text.pixel.zoom(scale)}>
                <button type="button" aria-label={text.pixel.zoomOut} onClick={() => setScale((value) => stepZoom(value, -1))}>
                  −
                </button>
                <output data-testid="pixel-zoom">{text.pixel.zoom(scale)}</output>
                <button type="button" aria-label={text.pixel.zoomIn} onClick={() => setScale((value) => stepZoom(value, 1))}>
                  +
                </button>
              </span>
            </div>

            <figure className="pixel-preview" title={text.pixel.previewHint}>
              <figcaption>{text.pixel.preview}</figcaption>
              <div className="pixel-preview-box">
                <div className="pixel-checker" style={{ width: film.width, height: film.height, "--cell": "8px" } as CSSProperties}>
                  <canvas
                    ref={previewRef}
                    width={film.width}
                    height={film.height}
                    data-testid="pixel-preview"
                    aria-label={text.pixel.previewHint}
                    role="img"
                  />
                </div>
              </div>
            </figure>
          </aside>

          <div className="pixel-stage">
            <div
              className="pixel-board pixel-checker"
              style={{ ...board, "--cell": `${cell}px`, "--scale": `${scale}px` } as CSSProperties}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onContextMenu={(event) => event.preventDefault()}
            >
              <canvas
                ref={canvasRef}
                width={film.width}
                height={film.height}
                role="img"
                aria-label={text.pixel.canvasHint(film.width, film.height)}
                data-testid="pixel-canvas"
                data-width={film.width}
                data-height={film.height}
                data-scale={scale}
                data-frame={shownFrame}
                style={board}
              />
              {grid && scale >= 4 ? <div className="pixel-grid" aria-hidden="true" data-testid="pixel-grid" /> : null}
              {!playing && film.selection ? (
                <div
                  className="pixel-selection"
                  data-testid="pixel-selection"
                  style={{
                    left: film.selection.x * scale,
                    top: film.selection.y * scale,
                    width: film.selection.w * scale,
                    height: film.selection.h * scale,
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>

        <PixelAnimPanel
          film={film}
          revision={revision}
          onion={onion}
          playing={playing}
          playFrame={playFrame}
          onToggleOnion={() => setOnion((value) => !value)}
          onTogglePlay={() => {
            if (playing) {
              setPlaying(false);
              return;
            }
            const order = playOrder(film.frames.length, film.states, null);
            playRef.current = { order, cursor: 0, into: 0 };
            setPlayFrame(order[0] ?? 0);
            setPlaying(true);
          }}
          onAddFrame={() => noteLimit(addBlankFrame(film))}
          onCopyFrame={() => noteLimit(duplicateFrame(film))}
          onDeleteFrame={() => noteLimit(deleteFrame(film))}
          onSelectFrame={(index) => {
            setPlaying(false);
            selectFrame(film, index);
            bump();
          }}
          onDuration={(ms) => {
            const result = setFrameDuration(film, film.index, ms);
            if (result === "size") {
              setPlaying(false);
              setLimit(text.pixel.anim.durationBad);
              bump();
              return;
            }
            noteLimit(result);
          }}
          onFps={(fps) => noteLimit(setFps(film, fps))}
          onToggleState={(name) => noteLimit(toggleStateFrame(film, name))}
          onAddLayer={() => noteLimit(addLayer(film))}
          onDeleteLayer={() => noteLimit(deleteLayer(film))}
          onMoveLayer={(direction) => {
            if (moveLayer(film, direction) === true) noteLimit(true);
          }}
          onSelectLayer={(index) => {
            selectLayer(film, index);
            bump();
          }}
          onToggleLayer={(index, visible) => {
            setLayerVisible(film, index, visible);
            bump();
          }}
          onImport={() => sheetInputRef.current?.click()}
        />

        <footer className="pixel-foot">
          <div className="pixel-status">
            {problem ? (
              <p className="pixel-problem" role="alert" data-testid="pixel-problem">
                {problem}
              </p>
            ) : null}
            {limit ? (
              <p className="pixel-problem" role="status" data-testid="pixel-anim-limit">
                {limit}
              </p>
            ) : null}
            {animProblem ? (
              <p role="status" data-testid="pixel-anim-problem">
                {animProblem}
              </p>
            ) : null}
            {hidden ? <p role="status">{text.pixel.anim.hiddenLayer}</p> : null}
            {savedPath && !dirty ? (
              <p role="status" data-testid="pixel-saved">
                <strong>{text.pixel.saved(savedPath)}</strong>
                {!animated ? <code>{text.pixel.use(savedPath)}</code> : null}
              </p>
            ) : null}
            {animated && sidePath ? (
              <pre className="pixel-snippet" data-testid="pixel-anim-snippet">
                {text.pixel.anim.snippet}
                {"\n"}
                {pygameAnimSnippet(target.path, sidePath)}
              </pre>
            ) : null}
            {exampleNote ? (
              <p role="status" data-testid="pixel-example-note">
                {exampleNote}
              </p>
            ) : null}
          </div>
          <div className="modal-actions">
            {onDisk ? (
              <>
                <button type="button" data-testid="pixel-put-module" disabled={saving} onClick={() => void putExample()}>
                  {text.pixel.anim.putModule}
                </button>
                <button type="button" data-testid="pixel-try-play" disabled={saving} onClick={() => setPrompt("demo")}>
                  {text.pixel.anim.tryPlay}
                </button>
              </>
            ) : null}
            <button
              type="button"
              data-testid="pixel-save-as"
              disabled={saving}
              onClick={() => {
                setSaveAsName(uniquePath(paths, target.path));
                setProblem("");
                setPrompt("save-as");
              }}
            >
              {text.pixel.saveAs}
            </button>
            <button
              type="button"
              className="run"
              data-testid="pixel-save"
              disabled={saving || (!dirty && target.mode === "overwrite")}
              onClick={() => void save(target)}
            >
              {saveLabel}
            </button>
          </div>
        </footer>

        <input
          ref={sheetInputRef}
          type="file"
          accept="image/png,.png"
          data-testid="pixel-sheet-file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void file.arrayBuffer().then(async (buffer) => {
              const loaded = await loadPixels(new Uint8Array(buffer));
              if (!loaded.ok) {
                setProblem(loaded.problem === "too-big" ? text.pixel.tooBig : text.pixel.unreadable);
                return;
              }
              const square = loaded.pixels.width % loaded.pixels.height === 0 ? loaded.pixels.height : loaded.pixels.width;
              setSheet({
                pixels: loaded.pixels,
                frameWidth: String(Math.min(square, loaded.pixels.width, 256)),
                frameHeight: String(Math.min(loaded.pixels.height, 256)),
              });
              setPrompt("sheet");
            });
          }}
        />

        {prompt === "close" ? (
          <div className="pixel-ask" role="alertdialog" aria-modal="true" aria-labelledby="pixel-ask-title" data-testid="pixel-unsaved">
            <h3 id="pixel-ask-title">{text.pixel.unsavedTitle}</h3>
            <p>{text.pixel.unsavedCopy}</p>
            {problem ? (
              <p className="pixel-problem" role="alert">
                {problem}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setPrompt(null)} autoFocus data-testid="pixel-keep">
                {text.pixel.unsavedKeep}
              </button>
              <button type="button" onClick={studio.closePixelEditor} data-testid="pixel-discard">
                {text.pixel.unsavedDiscard}
              </button>
              <button
                type="button"
                className="run"
                disabled={saving}
                data-testid="pixel-save-close"
                onClick={() =>
                  void save(target).then((ok) => {
                    if (ok) studio.closePixelEditor();
                  })
                }
              >
                {text.pixel.unsavedSave}
              </button>
            </div>
          </div>
        ) : null}

        {prompt === "save-as" ? (
          <form
            className="pixel-ask"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pixel-ask-title"
            data-testid="pixel-saveas-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (!askName || askTaken) return;
              void save({ path: askName, mode: "create" }).then((ok) => {
                if (ok) setPrompt(null);
              });
            }}
          >
            <h3 id="pixel-ask-title">{text.pixel.saveAsTitle}</h3>
            <p>{text.pixel.saveAsCopy}</p>
            <label className="pixel-field">
              <span>{text.pixel.name}</span>
              <input
                value={saveAsName}
                autoFocus
                spellCheck={false}
                data-testid="pixel-saveas-name"
                aria-invalid={askTaken || (saveAsName.trim() !== "" && !askName)}
                onChange={(event) => setSaveAsName(event.target.value)}
              />
              <small>{text.pixel.nameHint}</small>
            </label>
            {saveAsName.trim() && !askName ? (
              <p className="pixel-problem" role="alert">
                {text.pixel.nameBad}
              </p>
            ) : null}
            {askTaken && askName ? (
              <p className="pixel-problem" role="alert" data-testid="pixel-saveas-taken">
                {text.pixel.nameTaken(uniquePath(paths, askName))}{" "}
                <button type="button" className="pixel-link" onClick={() => setSaveAsName(uniquePath(paths, askName))}>
                  {text.pixel.useName(uniquePath(paths, askName))}
                </button>
              </p>
            ) : null}
            {problem ? (
              <p className="pixel-problem" role="alert" data-testid="pixel-saveas-problem">
                {problem}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setPrompt(null)}>
                {text.pixel.cancel}
              </button>
              <button className="run" type="submit" disabled={saving || !askName || askTaken} data-testid="pixel-saveas-confirm">
                {text.pixel.saveAsConfirm}
              </button>
            </div>
          </form>
        ) : null}

        {prompt === "sheet" && sheet ? (
          <form
            className="pixel-ask"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pixel-ask-title"
            data-testid="pixel-sheet-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              const result = replaceWithSheet(film, sheet.pixels, Number(sheet.frameWidth), Number(sheet.frameHeight));
              if (result !== true) {
                setLimit(limitText(result));
                return;
              }
              setPlaying(false);
              setPrompt(null);
              setSheet(null);
              setLimit("");
              bump();
            }}
          >
            <h3 id="pixel-ask-title">{text.pixel.anim.importTitle}</h3>
            <p>{text.pixel.anim.importCopy}</p>
            <div className="pixel-size-inputs">
              <label>
                <span>{text.pixel.anim.frameWidth}</span>
                <input
                  inputMode="numeric"
                  value={sheet.frameWidth}
                  data-testid="pixel-sheet-width"
                  onChange={(event) => setSheet({ ...sheet, frameWidth: event.target.value })}
                />
              </label>
              <label>
                <span>{text.pixel.anim.frameHeight}</span>
                <input
                  inputMode="numeric"
                  value={sheet.frameHeight}
                  data-testid="pixel-sheet-height"
                  onChange={(event) => setSheet({ ...sheet, frameHeight: event.target.value })}
                />
              </label>
            </div>
            {limit ? (
              <p className="pixel-problem" role="alert" data-testid="pixel-sheet-problem">
                {limit}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setPrompt(null)}>
                {text.pixel.cancel}
              </button>
              <button className="run" type="submit" data-testid="pixel-sheet-confirm">
                {text.pixel.anim.importConfirm}
              </button>
            </div>
          </form>
        ) : null}

        {prompt === "demo" && sidePath ? (
          <div className="pixel-ask" role="alertdialog" aria-modal="true" aria-labelledby="pixel-ask-title" data-testid="pixel-try-dialog">
            <h3 id="pixel-ask-title">{text.pixel.anim.tryTitle}</h3>
            <p>{text.pixel.anim.tryCopy}</p>
            {problem ? (
              <p className="pixel-problem" role="alert">
                {problem}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setPrompt(null)}>
                {text.pixel.cancel}
              </button>
              <button
                type="button"
                className="run"
                data-testid="pixel-try-confirm"
                disabled={saving}
                onClick={() => void putExample(pygameAnimDemo(target.path, sidePath))}
              >
                {text.pixel.anim.tryConfirm}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
