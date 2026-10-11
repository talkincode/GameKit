import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { linePoints } from "../lib/pixel/buffer";
import type { Pixels } from "../lib/pixel/buffer";
import { decodePng, encodePng } from "../lib/pixel/png";
import {
  exportBundle,
  importBundle,
  pathsOf,
  readMapFiles,
  retargetDraft,
  slugFromDocumentPath,
  writeMapFiles,
  type MapDraft,
  type MapReadError,
} from "../lib/map/document";
import { historyPush, historyRedo, historyStart, historyUndo, type MapHistory } from "../lib/map/history";
import {
  BACKGROUNDS,
  OBJECT_KINDS,
  STARTER_TILES,
  addLayer,
  createMap,
  deleteLayer,
  fillCollision,
  fillLayer,
  inMap,
  mapFingerprint,
  moveLayer,
  paintCollision,
  paintLayer,
  rectPoints,
  setBackground,
  setLayerVisible,
  setSpawn,
  solidCount,
  tileCount,
  toggleObject,
  type TileMap,
} from "../lib/map/model";
import { pygameMapDemo, pygameMapModule, pygameMapSnippet } from "../lib/map/pygame";
import { starterTileset } from "../lib/map/tileset";
import { downloadBytes } from "../lib/session";
import { useStudio, type MapSession } from "../studio/store";
import { text } from "./text";
import "./map-editor.css";

type Tool = "pencil" | "rect" | "fill" | "erase" | "spawn" | "object";
type Mode = "paint" | "collision";
type Prompt = "close" | "try" | null;

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "pencil", label: text.map.pencil, hint: text.map.pencilHint },
  { id: "rect", label: text.map.rect, hint: text.map.rectHint },
  { id: "fill", label: text.map.fill, hint: text.map.fillHint },
  { id: "erase", label: text.map.erase, hint: text.map.eraseHint },
  { id: "spawn", label: text.map.spawn, hint: text.map.spawnHint },
  { id: "object", label: text.map.object, hint: text.map.objectHint },
];

type Gesture = {
  origin: MapDraft;
  tool: Tool;
  mode: Mode;
  layer: number;
  tile: number;
  kind: string;
  anchor: [number, number];
  end: [number, number];
  points: [number, number][];
};

export function MapEditor() {
  const studio = useStudio();
  const session = studio.mapSession;
  if (!session) return null;
  if (session.source === "file") {
    const read = readMapFiles(session.files, session.path);
    if (!read.ok) return <MapOpenError reason={read.reason} />;
    return (
      <MapPainter
        key={session.id}
        session={session}
        initial={read.draft}
        saveMode="overwrite"
        owned={pathsOf(read.draft.map) ?? []}
      />
    );
  }
  const map = createMap(session);
  const decoded = session.tilesetPng ? decodePng(session.tilesetPng) : null;
  const tileset = decoded?.ok ? decoded.pixels : starterTileset(session.tileWidth);
  const tilesetPng = session.tilesetPng ?? (tileset ? encodePng(tileset) : null);
  if (!map || !tileset || !tilesetPng) return <MapOpenError reason="size" />;
  return (
    <MapPainter
      key={session.id}
      session={session}
      initial={{ map, tileset, tilesetPng }}
      saveMode="create"
      owned={[]}
    />
  );
}

function MapOpenError({ reason }: { reason: MapReadError }) {
  const studio = useStudio();
  return (
    <div className="modal-back">
      <div className="modal map-new" role="dialog" aria-modal="true" data-testid="map-open-error" aria-label={text.map.title}>
        <h2>{text.map.openError}</h2>
        <p className="map-problem" role="alert">
          {text.map.read[reason]}
        </p>
        <div className="modal-actions">
          <button type="button" onClick={studio.closeMapEditor}>
            {text.map.close}
          </button>
        </div>
      </div>
    </div>
  );
}

function MapPainter({
  session,
  initial,
  saveMode,
  owned,
}: {
  session: MapSession;
  initial: MapDraft;
  saveMode: "create" | "overwrite";
  owned: string[];
}) {
  const studio = useStudio();
  const slug = session.source === "new" ? session.slug : (slugFromDocumentPath(session.path) ?? initial.map.slug);
  const [history, setHistory] = useState<MapHistory>(() => historyStart(initial));
  const [tool, setTool] = useState<Tool>("pencil");
  const [mode, setMode] = useState<Mode>("paint");
  const [layerIndex, setLayerIndex] = useState(0);
  const [tile, setTile] = useState(1);
  const [objectKind, setObjectKind] = useState<(typeof OBJECT_KINDS)[number]["id"]>("coin");
  const [scale, setScale] = useState(2);
  const [showMarks, setShowMarks] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [limit, setLimit] = useState("");
  const [savedPath, setSavedPath] = useState(session.source === "file" ? session.path : "");
  const [modeNow, setModeNow] = useState(saveMode);
  const [ownedNow, setOwnedNow] = useState(owned);
  const [exampleNote, setExampleNote] = useState("");
  const [prompt, setPrompt] = useState<Prompt>(null);
  const draft = history.present;
  const map = draft.map;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const sheet = useMemo(() => pixelsToCanvas(draft.tileset), [draft.tileset]);
  const active = Math.min(layerIndex, map.layers.length - 1);
  const chosenTile = Math.min(tile, tileCount(map));
  const documentPath = `maps/${slug}.map.json`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paintCanvas(canvas, draft, sheet, showMarks);
  }, [draft, sheet, showMarks]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest?.("input, textarea");
      if (event.key === "Escape") {
        event.preventDefault();
        if (prompt) setPrompt(null);
        else requestClose();
        return;
      }
      if (typing || prompt) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    const requestClose = () => {
      if (dirty) setPrompt("close");
      else studio.closeMapEditor();
    };
    const undo = () => {
      setHistory((current) => historyUndo(current) ?? current);
      setDirty(true);
    };
    const redo = () => {
      setHistory((current) => historyRedo(current) ?? current);
      setDirty(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, prompt, studio]);

  const push = (origin: MapDraft, next: TileMap) => {
    setHistory((current) => historyPush({ past: current.past, present: origin, future: [] }, { ...origin, map: next }));
    setDirty(true);
    setProblem("");
    setLimit("");
    setExampleNote("");
  };

  const preview = (origin: MapDraft, next: TileMap | null) => {
    if (!next) return;
    setHistory((current) => ({ ...current, present: { ...origin, map: next } }));
  };

  const cellOf = (event: ReactPointerEvent): [number, number] | null => {
    const canvas = canvasRef.current;
    const current = historyRef.current.present.map;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * current.columns);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * current.rows);
    return inMap(current, x, y) ? [x, y] : null;
  };

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (saving || event.button !== 0) return;
    const cell = cellOf(event);
    if (!cell) return;
    const layer = map.layers[active];
    const painting = tool === "pencil" || tool === "rect" || tool === "fill" || tool === "erase";
    if (painting && mode === "paint" && layer && !layer.visible) {
      setLimit(text.map.hidden);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = historyRef.current.present;
    const gesture: Gesture = {
      origin,
      tool,
      mode,
      layer: active,
      tile: chosenTile,
      kind: objectKind,
      anchor: cell,
      end: cell,
      points: [cell],
    };
    if (tool === "fill" || tool === "spawn" || tool === "object") {
      const next = applyTool(origin.map, gesture, [cell]);
      if (!next && tool === "object" && origin.map.objects.length >= 32) setLimit(text.map.objectLimit);
      if (next) push(origin, next);
      return;
    }
    gestureRef.current = gesture;
    const points = tool === "rect" ? rectPoints(cell[0], cell[1], cell[0], cell[1]) : [cell];
    preview(origin, applyTool(origin.map, gesture, points));
  };

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const cell = cellOf(event);
    if (!cell) return;
    gesture.end = cell;
    if (gesture.tool === "rect") {
      preview(gesture.origin, applyTool(gesture.origin.map, gesture, rectPoints(gesture.anchor[0], gesture.anchor[1], cell[0], cell[1])));
      return;
    }
    const last = gesture.points.at(-1);
    if (!last || (last[0] === cell[0] && last[1] === cell[1])) return;
    for (const point of linePoints(last[0], last[1], cell[0], cell[1]).slice(1)) gesture.points.push(point);
    preview(gesture.origin, applyTool(gesture.origin.map, gesture, gesture.points));
  };

  const onUp = () => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    const points =
      gesture.tool === "rect"
        ? rectPoints(gesture.anchor[0], gesture.anchor[1], gesture.end[0], gesture.end[1])
        : gesture.points;
    const next = applyTool(gesture.origin.map, gesture, points);
    if (next) push(gesture.origin, next);
    else setHistory((current) => ({ ...current, present: gesture.origin }));
  };

  const save = async (): Promise<boolean> => {
    const files = writeMapFiles(historyRef.current.present.map, historyRef.current.present.tilesetPng);
    if (!files) {
      setProblem(text.map.failed["bad-map"]);
      return false;
    }
    setSaving(true);
    const result = await studio.saveMap({ mode: modeNow, previousPaths: ownedNow, ...files });
    setSaving(false);
    if (!result.ok) {
      setProblem(text.map.failed[result.reason]);
      return false;
    }
    setModeNow("overwrite");
    setOwnedNow([files.documentPath, files.tilesetPath, ...files.texts.map((file) => file.path)]);
    setSavedPath(result.path);
    setDirty(false);
    setProblem("");
    return true;
  };

  const putModule = async (mainText?: string): Promise<boolean> => {
    const result = await studio.saveMapExample({
      moduleText: pygameMapModule(),
      mainText,
    });
    if (!result.ok) {
      setProblem(text.map.failed[result.reason === "write-failed" ? "write-failed" : result.reason === "no-project" ? "no-project" : "bad-path"]);
      return false;
    }
    if (result.module === "wrote") setExampleNote(text.map.moduleWrote);
    else if (result.module === "kept") setExampleNote(text.map.moduleKept);
    else setExampleNote(text.map.moduleSame);
    return true;
  };

  const onImport = async (file: File) => {
    const read = importBundle(await file.text());
    if (!read.ok) {
      setProblem(text.map.read[read.reason]);
      return;
    }
    const moved = retargetDraft(read.draft, slug);
    if (!moved) {
      setProblem(text.map.read.format);
      return;
    }
    setHistory((current) => historyPush(current, moved));
    setDirty(true);
    setProblem("");
    setSavedPath("");
    setLayerIndex(0);
    setTile(1);
  };

  const fingerprint = mapFingerprint(map);
  return (
    <div className="modal-back">
      <div
        className="modal map-editor"
        role="dialog"
        aria-modal="true"
        aria-label={text.map.title}
        data-testid="map-editor"
        data-dirty={dirty ? "true" : "false"}
        tabIndex={-1}
        ref={rootRef}
      >
        <header className="map-head">
          <h2>{text.map.titleFor(map.name, map.columns, map.rows)}</h2>
          {dirty ? <span className="map-dirty">{text.map.dirty}</span> : null}
          <button type="button" data-testid="map-close" onClick={() => (dirty ? setPrompt("close") : studio.closeMapEditor())}>
            {text.map.close}
          </button>
        </header>
        <div className="map-body">
          <aside className="map-tools" aria-label={text.map.tools}>
            <div className="map-tool-row" role="group" aria-label={text.map.tools}>
              {TOOLS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={tool === item.id ? "map-tool on" : "map-tool"}
                  aria-pressed={tool === item.id}
                  title={item.hint}
                  data-testid={`map-tool-${item.id}`}
                  onClick={() => setTool(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="map-mode" role="group" aria-label={text.map.modeCollision}>
              <button
                type="button"
                className={mode === "paint" ? "on" : ""}
                aria-pressed={mode === "paint"}
                data-testid="map-mode-paint"
                onClick={() => setMode("paint")}
              >
                {text.map.modePaint}
              </button>
              <button
                type="button"
                className={mode === "collision" ? "on" : ""}
                aria-pressed={mode === "collision"}
                data-testid="map-mode-collision"
                onClick={() => setMode("collision")}
              >
                {text.map.modeCollision}
              </button>
            </div>
            {mode === "collision" ? <p className="map-note">{text.map.collisionHint}</p> : null}
            <div className="map-palette" role="group" aria-label={text.map.palette}>
              {Array.from({ length: tileCount(map) }, (_, index) => {
                const id = index + 1;
                const swatch = STARTER_TILES[index];
                const label = (session.source === "new" ? session.tileNames?.[index] : undefined) ?? swatch?.name ?? `${id}`;
                return (
                  <button
                    key={id}
                    type="button"
                    className={chosenTile === id ? "map-tile on" : "map-tile"}
                    aria-pressed={chosenTile === id}
                    aria-label={label}
                    data-testid={`map-tile-${id}`}
                    onClick={() => {
                      setTile(id);
                      if (tool === "spawn" || tool === "object") setTool("pencil");
                      setMode("paint");
                    }}
                  >
                    <TileFace tileset={draft.tileset} index={id} tileWidth={map.tileWidth} tileHeight={map.tileHeight} columns={map.tilesetColumns} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="map-zoom" role="group" aria-label={text.map.zoom(scale)}>
              <button type="button" aria-label={text.map.zoomOut} onClick={() => setScale((value) => Math.max(1, value - 1))}>
                −
              </button>
              <span>{text.map.zoom(scale)}</span>
              <button type="button" aria-label={text.map.zoomIn} onClick={() => setScale((value) => Math.min(4, value + 1))}>
                +
              </button>
            </div>
            <button type="button" data-testid="map-undo" onClick={() => setHistory((current) => historyUndo(current) ?? current)}>
              {text.map.undo}
            </button>
            <button type="button" data-testid="map-redo" onClick={() => setHistory((current) => historyRedo(current) ?? current)}>
              {text.map.redo}
            </button>
          </aside>
          <div className="map-stage">
            <div className="map-board" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <canvas
                ref={canvasRef}
                data-testid="map-canvas"
                data-columns={map.columns}
                data-rows={map.rows}
                data-scale={scale}
                data-tile-width={map.tileWidth}
                role="img"
                aria-label={text.map.canvasHint(map.columns, map.rows)}
                style={{ width: map.columns * map.tileWidth * scale, height: map.rows * map.tileHeight * scale }}
              />
            </div>
          </div>
          <aside className="map-side">
            <div className="map-layers" role="group" aria-label={text.map.layers}>
              {map.layers.map((layer, index) => (
                <div className="map-layer-row" key={layer.id}>
                  <button
                    type="button"
                    className={active === index ? "map-layer on" : "map-layer"}
                    aria-pressed={active === index}
                    data-testid={`map-layer-${index}`}
                    onClick={() => setLayerIndex(index)}
                  >
                    {layer.name}
                  </button>
                  <button
                    type="button"
                    aria-pressed={layer.visible}
                    aria-label={layer.visible ? text.map.layerHide : text.map.layerShow}
                    data-testid={`map-layer-visible-${index}`}
                    onClick={() => {
                      const next = setLayerVisible(map, index, !layer.visible);
                      if (next) push(draft, next);
                    }}
                  >
                    {layer.visible ? "●" : "○"}
                  </button>
                </div>
              ))}
              <button
                type="button"
                data-testid="map-layer-add"
                onClick={() => {
                  const next = addLayer(map);
                  if (!next) {
                    setLimit(text.map.layerLimit);
                    return;
                  }
                  push(draft, next);
                  setLayerIndex(next.layers.length - 1);
                }}
              >
                {text.map.addLayer}
              </button>
              <button
                type="button"
                data-testid="map-layer-delete"
                onClick={() => {
                  const next = deleteLayer(map, active);
                  if (!next) {
                    setLimit(text.map.lastLayer);
                    return;
                  }
                  push(draft, next);
                  setLayerIndex(Math.max(0, active - 1));
                }}
              >
                {text.map.deleteLayer}
              </button>
              <button
                type="button"
                data-testid="map-layer-up"
                onClick={() => {
                  const next = moveLayer(map, active, 1);
                  if (!next) return;
                  push(draft, next);
                  setLayerIndex(active + 1);
                }}
              >
                {text.map.layerUp}
              </button>
              <button
                type="button"
                data-testid="map-layer-down"
                onClick={() => {
                  const next = moveLayer(map, active, -1);
                  if (!next) return;
                  push(draft, next);
                  setLayerIndex(active - 1);
                }}
              >
                {text.map.layerDown}
              </button>
            </div>
            <div className="map-bg" role="group" aria-label={text.map.background}>
              {BACKGROUNDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={map.background === item.color ? "on" : ""}
                  aria-pressed={map.background === item.color}
                  data-testid={`map-bg-${item.id}`}
                  onClick={() => {
                    const next = setBackground(map, item.color);
                    if (next) push(draft, next);
                  }}
                >
                  {text.map.backgrounds[item.id]}
                </button>
              ))}
            </div>
            <div className="map-mode" role="group" aria-label={text.map.object}>
              {OBJECT_KINDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={objectKind === item.id ? "on" : ""}
                  aria-pressed={objectKind === item.id}
                  data-testid={`map-kind-${item.id}`}
                  onClick={() => {
                    setObjectKind(item.id);
                    setTool("object");
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <label>
              <input
                type="checkbox"
                checked={showMarks}
                data-testid="map-show-collision"
                onChange={(event) => setShowMarks(event.target.checked)}
              />{" "}
              {text.map.showCollision}
            </label>
            <p className="map-readout" data-testid="map-readout" data-fingerprint={fingerprint} data-solids={solidCount(map)} data-objects={map.objects.length} data-spawn={text.map.spawnAt(map.spawn.tileX, map.spawn.tileY)}>
              {text.map.readout(text.map.spawnAt(map.spawn.tileX, map.spawn.tileY), solidCount(map), map.objects.length)}
            </p>
          </aside>
        </div>
        <footer className="map-foot">
          {problem ? (
            <p className="map-problem" role="alert" data-testid="map-problem">
              {problem}
            </p>
          ) : null}
          {limit ? (
            <p className="map-problem" role="status" data-testid="map-limit">
              {limit}
            </p>
          ) : null}
          {savedPath && !dirty ? (
            <p role="status" data-testid="map-saved">
              {text.map.saved(savedPath)}
            </p>
          ) : null}
          {exampleNote ? (
            <p role="status" data-testid="map-example-note">
              {exampleNote}
            </p>
          ) : null}
          <pre className="map-snippet" data-testid="map-snippet">
            {text.map.snippet}
            {"\n"}
            {pygameMapSnippet(documentPath)}
          </pre>
          <button type="button" className="run" data-testid="map-save" disabled={saving} onClick={() => void save()}>
            {saving ? text.map.saving : text.map.save}
          </button>
          <button
            type="button"
            data-testid="map-export"
            onClick={() => {
              const bundle = exportBundle(historyRef.current.present);
              if (!bundle) {
                setProblem(text.map.failed["bad-map"]);
                return;
              }
              downloadBytes(`${slug}.map-bundle.json`, new TextEncoder().encode(bundle), "application/json");
            }}
          >
            {text.map.exportBundle}
          </button>
          <button type="button" data-testid="map-import" onClick={() => importRef.current?.click()}>
            {text.map.importBundle}
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="map-import-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onImport(file);
            }}
          />
          <button type="button" data-testid="map-put-module" onClick={() => void putModule()}>
            {text.map.putModule}
          </button>
          <button type="button" data-testid="map-try-play" disabled={dirty || !savedPath} onClick={() => setPrompt("try")}>
            {text.map.tryPlay}
          </button>
        </footer>
        {prompt ? (
          <div className="map-ask" data-testid={prompt === "try" ? "map-try-dialog" : "map-ask"}>
            <div>
              <h3>{prompt === "try" ? text.map.tryTitle : text.map.unsavedTitle}</h3>
              <p>{prompt === "try" ? text.map.tryCopy : text.map.unsavedCopy}</p>
              <div className="modal-actions">
                <button type="button" onClick={() => setPrompt(null)}>
                  {prompt === "try" ? text.map.cancel : text.map.unsavedKeep}
                </button>
                {prompt === "close" ? (
                  <button type="button" data-testid="map-discard" onClick={studio.closeMapEditor}>
                    {text.map.unsavedDiscard}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="run"
                  data-testid={prompt === "try" ? "map-try-confirm" : "map-ask-save"}
                  onClick={() => {
                    if (prompt === "try") {
                      setPrompt(null);
                      void putModule(pygameMapDemo(savedPath || documentPath)).then((ok) => {
                        if (ok) void studio.run();
                      });
                      return;
                    }
                    void save().then((ok) => {
                      if (ok) studio.closeMapEditor();
                    });
                  }}
                >
                  {prompt === "try" ? text.map.tryConfirm : text.map.unsavedSave}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function applyTool(map: TileMap, gesture: Gesture, points: readonly (readonly [number, number])[]): TileMap | null {
  if (!points.length) return null;
  if (gesture.tool === "spawn") return setSpawn(map, points[0][0], points[0][1]);
  if (gesture.tool === "object") return toggleObject(map, points[0][0], points[0][1], gesture.kind);
  const collision = gesture.mode === "collision";
  const value = gesture.tool === "erase" ? 0 : collision ? 1 : gesture.tile;
  if (gesture.tool === "fill") {
    const [x, y] = points[0];
    return collision ? fillCollision(map, x, y, value === 0 ? 0 : 1) : fillLayer(map, gesture.layer, x, y, value);
  }
  if (collision) return paintCollision(map, points, value === 0 ? 0 : 1);
  return paintLayer(map, gesture.layer, points, value);
}

function pixelsToCanvas(pixels: Pixels): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (context) {
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  }
  return canvas;
}

function paintCanvas(canvas: HTMLCanvasElement, draft: MapDraft, sheet: HTMLCanvasElement, showMarks: boolean) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const map = draft.map;
  canvas.width = map.columns * map.tileWidth;
  canvas.height = map.rows * map.tileHeight;
  context.imageSmoothingEnabled = false;
  context.fillStyle = map.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const layer of map.layers) {
    if (!layer.visible) continue;
    for (let y = 0; y < map.rows; y += 1) {
      for (let x = 0; x < map.columns; x += 1) {
        const index = layer.cells[y * map.columns + x];
        if (!index) continue;
        const cell = index - 1;
        const sx = (cell % map.tilesetColumns) * map.tileWidth;
        const sy = Math.floor(cell / map.tilesetColumns) * map.tileHeight;
        context.drawImage(sheet, sx, sy, map.tileWidth, map.tileHeight, x * map.tileWidth, y * map.tileHeight, map.tileWidth, map.tileHeight);
      }
    }
  }
  context.strokeStyle = "rgba(28, 30, 26, 0.2)";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 1; x < map.columns; x += 1) {
    context.moveTo(x * map.tileWidth + 0.5, 0);
    context.lineTo(x * map.tileWidth + 0.5, canvas.height);
  }
  for (let y = 1; y < map.rows; y += 1) {
    context.moveTo(0, y * map.tileHeight + 0.5);
    context.lineTo(canvas.width, y * map.tileHeight + 0.5);
  }
  context.stroke();
  if (!showMarks) return;
  context.fillStyle = "rgba(228, 87, 46, 0.38)";
  for (let y = 0; y < map.rows; y += 1) {
    for (let x = 0; x < map.columns; x += 1) {
      if (map.collision[y * map.columns + x] === 1) {
        context.fillRect(x * map.tileWidth, y * map.tileHeight, map.tileWidth, map.tileHeight);
      }
    }
  }
  context.strokeStyle = "#ffd84a";
  context.lineWidth = 2;
  context.strokeRect(map.spawn.tileX * map.tileWidth + 1, map.spawn.tileY * map.tileHeight + 1, map.tileWidth - 2, map.tileHeight - 2);
  context.fillStyle = "#2a6fdb";
  for (const object of map.objects) {
    context.beginPath();
    context.arc(
      object.tileX * map.tileWidth + map.tileWidth / 2,
      object.tileY * map.tileHeight + map.tileHeight / 2,
      Math.max(2, map.tileWidth / 5),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function TileFace({
  tileset,
  index,
  tileWidth,
  tileHeight,
  columns,
}: {
  tileset: Pixels;
  index: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = tileWidth;
    canvas.height = tileHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = context.createImageData(tileWidth, tileHeight);
    const cell = index - 1;
    const originX = (cell % columns) * tileWidth;
    const originY = Math.floor(cell / columns) * tileHeight;
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        const from = ((originY + y) * tileset.width + originX + x) * 4;
        image.data.set(tileset.data.subarray(from, from + 4), (y * tileWidth + x) * 4);
      }
    }
    context.putImageData(image, 0, 0);
  }, [tileset, index, tileWidth, tileHeight, columns]);
  return <canvas ref={ref} aria-hidden="true" />;
}
