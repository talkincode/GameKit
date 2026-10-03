import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { type Pixels, type Rgba, TRANSPARENT, createPixels, parseHex, toHex } from "../lib/pixel/buffer";
import { loadPixels } from "../lib/pixel/load";
import { PALETTE } from "../lib/pixel/palette";
import { encodePng } from "../lib/pixel/png";
import { boardBudget, imagePath, startZoom, stepZoom } from "../lib/pixel/rules";
import {
  type Session,
  type Tool,
  clearAll,
  createSession,
  endStroke,
  isDirty,
  markSaved,
  pointerDown,
  pointerMove,
  pointerUp,
  redoStep,
  undoStep,
} from "../lib/pixel/session";
import { uniquePath } from "../lib/project";
import { type PixelSession, useStudio } from "../studio/store";
import { PixelSwatches } from "./PixelSwatches";
import { text } from "./text";
import "./pixel-editor.css";

type Loaded =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; session: Session };

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
      setLoaded({ status: "ready", session: createSession(createPixels(open.width, open.height, fill)) });
      return;
    }
    void loadPixels(open.bytes).then((result) => {
      if (cancel) return;
      if (result.ok) setLoaded({ status: "ready", session: createSession(result.pixels) });
      else setLoaded({ status: "error", message: result.problem === "too-big" ? text.pixel.tooBig : text.pixel.unreadable });
    });
    return () => {
      cancel = true;
    };
  }, [open]);

  if (loaded.status === "ready") return <Workspace open={open} session={loaded.session} />;
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

type SavePrompt = null | "close" | "save-as";

function Workspace({ open, session }: { open: PixelSession; session: Session }) {
  const studio = useStudio();
  const { width, height }: Pixels = session.pixels;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const activePointer = useRef<number | null>(null);
  const busy = useRef(false);
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState<Rgba>(() => parseHex(PALETTE[0]) as Rgba);
  const [grid, setGrid] = useState(true);
  const [scale, setScale] = useState(() => {
    const box = boardBudget(window.innerWidth, window.innerHeight);
    return startZoom(width, height, box.width, box.height);
  });
  const [target, setTarget] = useState({ path: open.path, mode: open.source === "file" ? ("overwrite" as const) : ("create" as const) });
  const [prompt, setPrompt] = useState<SavePrompt>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [saveAsName, setSaveAsName] = useState("");

  const image = useMemo(() => new ImageData(session.pixels.data, width, height), [session, width, height]);
  const redraw = useCallback(() => {
    for (const ref of [canvasRef, previewRef]) ref.current?.getContext("2d")?.putImageData(image, 0, 0);
  }, [image]);
  useLayoutEffect(redraw);

  const paths = useMemo(() => studio.project?.files.map((file) => file.path) ?? [], [studio.project]);
  const dirty = isDirty(session);

  const requestClose = () => {
    if (busy.current) return;
    endStroke(session);
    if (isDirty(session)) setPrompt("close");
    else studio.closePixelEditor();
  };

  /** Writes the picture. On any failure the canvas, the history and the dirty flag stay as they were. */
  const save = async (to: { path: string; mode: "create" | "overwrite" }): Promise<boolean> => {
    if (busy.current) return false;
    endStroke(session);
    busy.current = true;
    setSaving(true);
    setProblem("");
    const result = await studio.savePixelImage({ path: to.path, bytes: encodePng(session.pixels), mode: to.mode });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setProblem(text.pixel.failed[result.reason]);
      return false;
    }
    markSaved(session);
    setTarget({ path: result.path, mode: "overwrite" });
    setSavedPath(result.path);
    bump();
    return true;
  };

  const doUndo = () => {
    if (busy.current) return;
    if (undoStep(session)) {
      redraw();
      bump();
    }
  };
  const doRedo = () => {
    if (busy.current) return;
    if (redoStep(session)) {
      redraw();
      bump();
    }
  };

  // Keep the keyboard handler pointing at the newest closures without re-binding it.
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
      if (!isDirty(session)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [session]);

  const cellOf = (clientX: number, clientY: number): [number, number] => {
    const rect = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    return [
      Math.floor(((clientX - rect.left) * width) / rect.width),
      Math.floor(((clientY - rect.top) * height) / rect.height),
    ];
  };

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy.current) return;
    if (activePointer.current !== null) {
      // A second finger is ignored; a pointer that never reported its end is closed off.
      if (!event.isPrimary) return;
      pointerUp(session);
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
    const result = pointerDown(session, tool, x, y, color);
    if (result.picked) {
      setColor(result.picked);
      setTool("pencil");
    }
    redraw();
  };

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointer.current) return;
    const native = event.nativeEvent;
    const steps = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    for (const step of steps.length ? steps : [native]) {
      const [x, y] = cellOf(step.clientX, step.clientY);
      pointerMove(session, tool, x, y, color);
    }
    redraw();
  };

  const onUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointer.current) return;
    activePointer.current = null;
    pointerUp(session);
    redraw();
    bump();
  };

  const toolButton = (id: Tool, label: string, hint: string, icon: string) => (
    <button
      type="button"
      className={`pixel-tool${tool === id ? " on" : ""}`}
      aria-label={label}
      aria-pressed={tool === id}
      title={hint}
      data-testid={`pixel-tool-${id}`}
      onClick={() => setTool(id)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={icon} />
      </svg>
      <span>{label}</span>
    </button>
  );

  const swatchValue = color[3] === 0 ? null : toHex(color);
  const board = { width: width * scale, height: height * scale };
  const cell = scale * Math.max(1, Math.round(8 / scale));
  const saveLabel = saving ? text.pixel.saving : text.pixel.save;
  const askName = saveAsName.trim() ? imagePath(saveAsName) : null;
  const askTaken = askName !== null && paths.includes(askName);

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
            {text.pixel.titleFor(target.path, width, height)}
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
            </div>
            <div className="pixel-tool-row">
              <button
                type="button"
                aria-label={text.pixel.undo}
                title={`${text.pixel.undo} (Ctrl/⌘+Z)`}
                aria-keyshortcuts="Control+Z Meta+Z"
                data-testid="pixel-undo"
                disabled={!session.history.done.length}
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
                disabled={!session.history.undone.length}
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
                  if (clearAll(session)) {
                    redraw();
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
                <div className="pixel-checker" style={{ width, height, "--cell": "8px" } as CSSProperties}>
                  <canvas
                    ref={previewRef}
                    width={width}
                    height={height}
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
                width={width}
                height={height}
                role="img"
                aria-label={text.pixel.canvasHint(width, height)}
                data-testid="pixel-canvas"
                data-width={width}
                data-height={height}
                data-scale={scale}
                style={board}
              />
              {grid && scale >= 4 ? <div className="pixel-grid" aria-hidden="true" data-testid="pixel-grid" /> : null}
            </div>
          </div>
        </div>

        <footer className="pixel-foot">
          <div className="pixel-status">
            {problem ? (
              <p className="pixel-problem" role="alert" data-testid="pixel-problem">
                {problem}
              </p>
            ) : savedPath && !dirty ? (
              <p role="status" data-testid="pixel-saved">
                <strong>{text.pixel.saved(savedPath)}</strong>
                <code>{text.pixel.use(savedPath)}</code>
              </p>
            ) : null}
          </div>
          <div className="modal-actions">
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
      </div>
    </div>
  );
}
