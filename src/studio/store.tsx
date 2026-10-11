import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import template from "../../runtime/player.tmpl?raw";
import {
  LOGIN_PATH,
  LOGOUT_PATH,
  callApi,
  fetchAccount,
  hasSignInHint,
  setSignInHint,
  takeLoginResult,
  type Account,
  type ApiOutcome,
} from "../lib/account";
import {
  RUN_EVIDENCE_MS,
  candidateDiff,
  foldStep,
  runAgentTurn,
  type AgentEvent,
  type AgentStep,
  type AgentTurnInput,
  type AgentTurnOutcome,
  type CandidateResult,
  type RunOutcome,
} from "../lib/agent";
import { GatewayError } from "../lib/adk/model";
import { forgetAllRunners, forgetProjectRunner, projectHasSession, projectRunner } from "../lib/adk/runner";
import { loadLibrary } from "../lib/assets/catalog";
import { materializeAsset, resolveCatalogCopy } from "../lib/assets/propose";
import { hitsFromPacks } from "../lib/assets/search";
import { explainMessages, readSay, type ChatImage, type ChatMessage } from "../lib/ai";
import { lessonFor } from "../lib/recipes/check";
import { createRecipeProject, recipeIdOf } from "../lib/recipes/catalog";
import { buildWebBundle } from "../lib/build";
import type { DesignCard } from "../lib/design";
import { diagnoseProject, problemsFromConsole, tracebackTail, type Problem } from "../lib/diagnostics";
import {
  embedZip,
  itchZip,
  projectFromArchive,
  sourceZip,
  staticFolderZip,
  webZip,
} from "../lib/export";
import {
  base64ToBytes,
  dropFromTrash,
  emptyTrash,
  normalizePath,
  renameFile,
  restoreFile,
  slugName,
  trashFile,
  uniquePath,
  upsertFile,
  type Project,
  type ProjectFile,
  type TrashedFile,
} from "../lib/project";
import { parseHex } from "../lib/pixel/buffer";
import { canEditPixels, checkSize, imagePath } from "../lib/pixel/rules";
import { animationSidecarPath, type SpriteAnimation } from "../lib/pixel/anim";
import { decodePng } from "../lib/pixel/png";
import { planAnimExample, planPixelSave, type AnimExampleInput, type AnimExampleResult, type PixelSaveFailure, type PixelSaveInput } from "../lib/pixel/save";
import { collisionCsvPath, layerCsvPath, mapDocumentPath, slugFromDocumentPath, tilesetPath, type MapFileBlob } from "../lib/map/document";
import { cleanMapName, createMap, isMapSlug } from "../lib/map/model";
import { planMapExample, planMapSave, type MapExampleInput, type MapExampleResult, type MapSaveFailure, type MapSaveInput } from "../lib/map/save";
import { discardPlay, downloadBytes, ensurePlayerServiceWorker, publishPlay } from "../lib/session";
import { budgetFor, loadSettings, saveSettings, type Settings } from "../lib/settings";
import { forgetKeptSound as forgetKeptRecord, keepSound as keepSoundRecord } from "../lib/audio/kept";
import { planSoundSave, type SoundSaveInput, type SoundSaveResult } from "../lib/audio/save";
import { readSoundSpec, type SoundSpec } from "../lib/audio/spec";
import { prepareAsset } from "../lib/sprite";
import { createBlankProject, createStarterProject } from "../lib/starter";
import { applyLibraryCopy, type LibraryCopyRequest, type LibraryCopyResult } from "../lib/assets/copy";
import { librarySpriteNote } from "../lib/assets/sprite-note";
import { deleteStoredProject, loadProjects, saveProject } from "../lib/storage";
import { text } from "../ui/text";

export type RunState = "idle" | "starting" | "running" | "stopped" | "error";
export type SaveState = "saved" | "saving" | "error";
export type MenuId = "project" | "export" | null;
/** 做游戏 is the product; 看代码 is where the implementation lives. */
export type ViewId = "design" | "code";
/** Whose build the stage is showing. */
export type StageOwner = "current" | "candidate";

/** 看代码 里的三块面板，各自可以收拢。 */
export type PanelId = "side" | "stage" | "bottom";
export type PanelState = Record<PanelId, boolean>;

export type AssetKind = "sprite" | "background" | "tile" | "icon";

/** Pixel sizes a child can pick for a sprite or icon. */
export type AssetSize = 32 | 48 | 64;

/** What a finished asset is resized to before it lands in assets/. */
function assetTarget(kind: AssetKind, size: AssetSize, cut: boolean) {
  if (kind === "background") return { width: 640, height: 360, mode: "cover" as const, cut: false };
  if (kind === "tile") return { width: size, height: size, mode: "cover" as const, cut: false };
  return { width: size, height: size, mode: "contain" as const, cut };
}

export type SoundKind = "sfx" | "music";

export type AssetDraft = {
  bytes: Uint8Array;
  mediaType: string;
  suggested: string;
  width: number;
  height: number;
  /** Kid-facing note about the picture itself, when there is something to say. */
  note?: string;
  /** Sound drafts also carry what to tell the child about using it. */
  sound?: { kind: SoundKind; say: string; seconds: number };
};

/** What the pixel editor was opened on. Bytes are copied in, so the editor owns its picture. */
export type PixelOpen =
  | { source: "new"; path: string; width: number; height: number; background: string | null }
  | { source: "file"; path: string; bytes: Uint8Array; animText: string | null }
  | { source: "draft"; path: string; bytes: Uint8Array };

/** An open editor. `projectId` pins it to the project it was opened for; `id` makes each opening fresh. */
export type PixelSession = PixelOpen & { id: number; projectId: string };

export type PixelNewInput = { path: string; width: unknown; height: unknown; background: string | null };

export type PixelSaveResult = { ok: true; path: string } | { ok: false; reason: PixelSaveFailure };

export type MapNewInput = {
  slug: string;
  name: string;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  /** A library tileset copied into the editor. The map stores this PNG, not a link. */
  tilesetColumns?: number;
  tilesetRows?: number;
  tilesetPng?: Uint8Array;
  tileNames?: string[];
};

export type MapOpen = ({ source: "new" } & MapNewInput) | { source: "file"; path: string; files: MapFileBlob[] };

/** An open map editor, pinned to the project it was opened for. */
export type MapSession = MapOpen & { id: number; projectId: string };

export type MapSaveResult = { ok: true; path: string } | { ok: false; reason: MapSaveFailure };

/**
 * One round in the conversation pane. It is a record of what happened, not a
 * source of truth: only 采用 writes into the project.
 */
export type Turn = {
  id: string;
  kind: "design" | "explain";
  /** What the child asked, in their own words. */
  request: string;
  /** Pictures attached to this round, kept only for the conversation. */
  images?: string[];
  steps: AgentStep[];
  design?: DesignCard;
  say: string;
  /** The newest candidate version of this round. */
  candidate?: CandidateResult;
  outcome?: AgentTurnOutcome;
  adopted: boolean;
  discarded: boolean;
  /** Explain turns only. */
  answer?: string;
};

/** What 撤销 restores: files, design card and trash together. */
type Snapshot = { projectId: string; files: ProjectFile[]; design?: DesignCard; trash?: TrashedFile[] };

/** A candidate preview waiting for evidence (see `RunOutcome`). */
type PendingRun = { turnId: string; resolve: (outcome: RunOutcome) => void; timer: number };

type StudioValue = {
  ready: boolean;
  account: Account;
  signIn: () => void;
  signOut: () => void;
  project: Project | null;
  projects: Project[];
  path: string;
  setPath: (path: string) => void;
  saveState: SaveState;
  runState: RunState;
  frameSrc: string;
  frameHtml: string;
  sendPreviewArchive: (target: WindowProxy | null) => void;
  stageOwner: StageOwner;
  consoleText: string;
  statusNote: string;
  fps: number | null;
  frameMs: number | null;
  inputs: string[];
  problems: Problem[];
  selection: string;
  setSelection: (value: string) => void;
  menu: MenuId;
  setMenu: (menu: MenuId) => void;
  remembers: boolean;
  settings: Settings;
  updateSettings: (next: Settings) => void;
  /** The model's context window, or null while unknown. */
  modelLimit: number | null;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  collabActive: boolean;
  collabUrl: string;
  startCollab: () => Promise<boolean>;
  stopCollab: () => Promise<void>;
  /** 我的项目：a panel of its own, not a dropdown of names. */
  projectsOpen: boolean;
  setProjectsOpen: (open: boolean) => void;
  view: ViewId;
  setView: (view: ViewId) => void;
  panels: PanelState;
  togglePanel: (panel: PanelId) => void;
  turns: Turn[];
  candidate: CandidateResult | null;
  turnBusy: boolean;
  activeStep?: AgentStep;
  canTurn: boolean;
  startTurn: (request: string, images?: ChatImage[]) => Promise<void>;
  cancelTurn: () => void;
  adoptCandidate: () => void;
  discardCandidate: () => void;
  explainSelection: () => Promise<void>;
  assetDraft: AssetDraft | null;
  assetKind: AssetKind;
  setAssetKind: (kind: AssetKind) => void;
  assetSize: AssetSize;
  setAssetSize: (size: AssetSize) => void;
  assetCut: boolean;
  setAssetCut: (cut: boolean) => void;
  assetOpen: boolean;
  setAssetOpen: (open: boolean) => void;
  soundOpen: boolean;
  setSoundOpen: (open: boolean) => void;
  pixelNewOpen: boolean;
  setPixelNewOpen: (open: boolean) => void;
  /** Built-in asset library. Browsing does not write; copying goes through commit. */
  libraryOpen: boolean;
  setLibraryOpen: (open: boolean) => void;
  /** Recipes always create a new project. Challenges read the open one. */
  recipesOpen: boolean;
  setRecipesOpen: (open: boolean) => void;
  challengeOpen: boolean;
  setChallengeOpen: (open: boolean) => void;
  /** New project from a recipe. `challenge` opens the step after the switch. */
  newRecipe: (id: string, challenge?: boolean) => void;
  /** The lesson's prepared edit, as a candidate. Does not call the model. */
  offerLessonCandidate: (recipeId: string) => void;
  /**
   * Names a catalog asset as a candidate. Does not write the open project.
   * A path that already holds different bytes is refused.
   */
  proposeCatalogAsset: (packId: string, assetId: string) => Promise<void>;
  copyLibraryAsset: (request: LibraryCopyRequest) => Promise<LibraryCopyResult>;
  /**
   * Copies a sprite sheet, writes the animation note beside it, and opens the editor.
   * A conflict returns needs-choice and does not open anything.
   */
  openLibrarySprite: (copy: LibraryCopyRequest["copy"], animation: SpriteAnimation, choice: LibraryCopyRequest["choice"]) => Promise<LibraryCopyResult>;
  pixelSession: PixelSession | null;
  /** Opens a blank canvas. False when the size or name is not allowed or the name is taken. */
  startPixelNew: (input: PixelNewInput) => boolean;
  /** Opens an existing PNG for editing. False when it is not a PNG in the project. */
  editPixelFile: (path: string) => boolean;
  /** Opens the generated picture that has not been saved yet. */
  editDraftPixels: () => void;
  closePixelEditor: () => void;
  /**
   * The only way the editor writes. The picture is on disk before the project
   * changes in memory, so a failed write leaves everything (and the canvas) as it was.
   */
  savePixelImage: (input: PixelSaveInput) => Promise<PixelSaveResult>;
  /** Puts the pygame helper in the project. Replaces main.py only when `mainText` is set. */
  saveAnimExample: (input: AnimExampleInput) => Promise<AnimExampleResult>;
  mapNewOpen: boolean;
  setMapNewOpen: (open: boolean) => void;
  mapSession: MapSession | null;
  /** Opens a blank map. False when the name is taken or the size is not allowed. */
  startMapNew: (input: MapNewInput) => boolean;
  /** Opens a saved `.map.json`. False when the path is not a map document. */
  editMapFile: (path: string) => boolean;
  closeMapEditor: () => void;
  /**
   * The only way the map editor writes. Files land on disk before memory
   * changes, so a failed write leaves the project and the canvas as they were.
   */
  saveMap: (input: MapSaveInput) => Promise<MapSaveResult>;
  /** Puts map_loader.py in the project. Replaces main.py only when `mainText` is set. */
  saveMapExample: (input: MapExampleInput) => Promise<MapExampleResult>;
  soundKind: SoundKind;
  setSoundKind: (kind: SoundKind) => void;
  /** Set when the model picks numbers. The editor renders this spec itself. */
  soundRecipe: { token: number; spec: SoundSpec } | null;
  clearSoundRecipe: () => void;
  /** Writes the previewed WAV. Replaces main.py only when mainText is set. */
  saveSound: (input: SoundSaveInput) => Promise<SoundSaveResult>;
  keepSound: (input: { bytes: Uint8Array; title: string; kind: SoundKind; tags: string[] }) => Promise<
    { ok: true } | { ok: false; reason: "bad-audio" | "write-failed" }
  >;
  forgetKeptSound: (id: string) => Promise<void>;
  soundLibraryVersion: number;
  aiBusy: boolean;
  notice: string;
  dismissNotice: () => void;
  bottomTab: "console" | "problems" | "debug";
  setBottomTab: (tab: "console" | "problems" | "debug") => void;
  updateText: (path: string, text: string) => void;
  createFile: (path: string) => boolean;
  renameCurrent: (from: string, to: string) => boolean;
  trashFile: (path: string) => void;
  restoreFromTrash: (path: string) => void;
  dropFromTrash: (path: string) => void;
  emptyTrash: () => void;
  addBytes: (path: string, bytes: Uint8Array) => void;
  importArchive: (file: File) => Promise<void>;
  newSample: () => Promise<void>;
  newBlank: (name: string) => void;
  openProject: (id: string) => void;
  renameProject: (name: string) => void;
  deleteProject: () => Promise<void>;
  duplicateProject: () => Promise<void>;
  exportSource: () => void;
  exportKind: (kind: "web" | "static" | "itch" | "embed") => void;
  run: () => Promise<void>;
  stop: () => void;
  noteStatus: (text: string) => void;
  noteConsole: (text: string) => void;
  noteReady: () => void;
  noteTick: (fps: number, frameMs: number) => void;
  noteInput: (detail: string) => void;
  undo: () => void;
  canUndo: boolean;
  generateAsset: (prompt: string) => Promise<void>;
  generateSound: (prompt: string) => Promise<void>;
  acceptAsset: () => void;
  clearAsset: () => void;
};

const StudioContext = createContext<StudioValue | null>(null);

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error("Studio context is missing.");
  return value;
}

const ACTIVE_KEY = "gamekit.active";
/** Panel layout is a preference, not project data: it lives in localStorage. */
const PANELS_KEY = "gamekit.panels";
const PANELS_DEFAULT: PanelState = { side: true, stage: true, bottom: true };

function readPanels(): PanelState {
  try {
    const stored = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "{}") as Partial<PanelState>;
    return {
      side: stored.side !== false,
      stage: stored.stage !== false,
      bottom: stored.bottom !== false,
    };
  } catch {
    return PANELS_DEFAULT;
  }
}

function writePanels(panels: PanelState): void {
  localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
}

/** Our chat content -> ADK parts: text, and pictures as inline data. */
function toAdkParts(content: unknown): { text?: string; inlineData?: { mimeType: string; data: string } }[] {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: "" }];
  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [];
  for (const item of content as { type?: string; text?: string; image_url?: { url?: string } }[]) {
    if (item?.type === "text" && typeof item.text === "string") parts.push({ text: item.text });
    if (item?.type === "image_url" && typeof item.image_url?.url === "string") {
      const match = /^data:([^;]+);base64,(.*)$/.exec(item.image_url.url);
      if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }
  return parts.length ? parts : [{ text: "" }];
}

/** Folds one agent event into the round it belongs to. */
function applyEvent(turn: Turn, event: AgentEvent): Turn {
  if (event.kind === "step") return { ...turn, steps: foldStep(turn.steps, event.step) };
  if (event.kind === "design") return { ...turn, design: event.design, say: event.say };
  return { ...turn, candidate: event.candidate };
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState("");
  const [path, setPath] = useState("main.py");
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [runState, setRunState] = useState<RunState>("idle");
  const [frameSrc, setFrameSrc] = useState("about:blank");
  const [frameHtml, setFrameHtml] = useState("");
  const [stageOwner, setStageOwner] = useState<StageOwner>("current");
  const [consoleText, setConsoleText] = useState("");
  const [statusNote, setStatusNote] = useState(text.stage.idle);
  const [fps, setFps] = useState<number | null>(null);
  const [frameMs, setFrameMs] = useState<number | null>(null);
  const [inputs, setInputs] = useState<string[]>([]);
  const [selection, setSelection] = useState("");
  const [menu, setMenu] = useState<MenuId>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Does the assistant already have a conversation about this project? */
  const [remembers, setRemembers] = useState(false);
  const [view, setView] = useState<ViewId>("design");
  const [panels, setPanels] = useState<PanelState>(() => readPanels());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [turnBusy, setTurnBusy] = useState(false);
  const [assetDraft, setAssetDraft] = useState<AssetDraft | null>(null);
  const [assetKind, setAssetKind] = useState<AssetKind>("sprite");
  const [assetSize, setAssetSize] = useState<AssetSize>(48);
  const [assetCut, setAssetCut] = useState(true);
  const [assetOpen, setAssetOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [soundKind, setSoundKind] = useState<SoundKind>("sfx");
  const [soundRecipe, setSoundRecipe] = useState<{ token: number; spec: SoundSpec } | null>(null);
  const [soundLibraryVersion, setSoundLibraryVersion] = useState(0);
  const [pixelNewOpen, setPixelNewOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [pixelSession, setPixelSession] = useState<PixelSession | null>(null);
  const [mapNewOpen, setMapNewOpen] = useState(false);
  const [mapSession, setMapSession] = useState<MapSession | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [bottomTab, setBottomTab] = useState<"console" | "problems" | "debug">("console");
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [runtimeProblems, setRuntimeProblems] = useState<Problem[]>([]);
  const [account, setAccount] = useState<Account>({ kind: "checking" });
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  /** The text model's context window, reported by the Worker. */
  const [modelLimit, setModelLimit] = useState<number | null>(null);
  const budgetRef = useRef(budgetFor(loadSettings().agentBudget, null).tokens);
  const variation = useRef(1);
  const project = projects.find((item) => item.id === activeId) ?? null;
  const projectRef = useRef(project);
  projectRef.current = project;
  /** Which view is on screen, for messages that belong to the other one. */
  const viewRef = useRef(view);
  viewRef.current = view;
  /** The round in flight, if any. Guards writes after a cancel or project switch. */
  const turnRef = useRef<{ id: string; projectId: string; cancelled: boolean } | null>(null);
  const pendingRun = useRef<PendingRun | null>(null);
  const previewGeneration = useRef(0);
  const previewActive = useRef(false);
  const runtimeError = useRef(false);
  const activePlaySession = useRef<string | null>(null);
  const previewArchive = useRef<Uint8Array | null>(null);
  const consoleRef = useRef("");
  /** Newest project whose save is still waiting on the debounce. */
  const pendingSave = useRef<{ timer: number | null; project: Project | null }>({ timer: null, project: null });
  /** Serializes writes so the newest state is always the last one on disk. */
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const pixelSessionRef = useRef(pixelSession);
  pixelSessionRef.current = pixelSession;
  const mapSessionRef = useRef(mapSession);
  mapSessionRef.current = mapSession;
  // Read at the moment of closing, not at the render the click came from: 保存并关闭 consumes the draft first.
  const assetDraftRef = useRef(assetDraft);
  assetDraftRef.current = assetDraft;
  const pixelCount = useRef(0);
  const mapCount = useRef(0);

  useEffect(() => {
    if (mapSession && mapSession.projectId !== project?.id) setMapSession(null);
  }, [project?.id, mapSession]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const stored = await loadProjects();
      if (cancel) return;
      if (!stored.length) {
        const starter = await createStarterProject();
        await saveProject(starter);
        setProjects([starter]);
        setActiveId(starter.id);
        localStorage.setItem(ACTIVE_KEY, starter.id);
      } else {
        setProjects(stored);
        const saved = localStorage.getItem(ACTIVE_KEY);
        setActiveId(stored.some((item) => item.id === saved) ? saved! : stored[0].id);
      }
      setReady(true);
    })().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : text.account.notes.failed);
      setReady(true);
    });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const result = takeLoginResult();
    if (result) setSignInHint(result === "ok");
    if (result && result !== "ok") setNotice(text.account.notes[result]);
    // Anonymous visitors never trigger an identity request.
    if (!hasSignInHint()) {
      setAccount({ kind: "anonymous" });
      return;
    }
    let cancel = false;
    void fetchAccount().then((next) => {
      if (cancel) return;
      if (next.kind === "anonymous") {
        setSignInHint(false);
        if (next.note) setNotice(text.account.notes[next.note]);
      }
      setAccount(next);
    });
    return () => {
      cancel = true;
    };
  }, []);

  /**
   * Calls an AI route. Returns null (after telling the child why) when the call
   * could not be made or did not succeed. `quiet` skips the generic failure
   * notice, for callers that report the failure themselves.
   */
  /** Tells the child what went wrong with an AI call, and updates who-is-signed-in. */
  const noteApiProblem = useCallback((problem: ApiOutcome<unknown>["ok"] extends never ? never : "sign-in" | "denied" | "unavailable" | "offline" | "error", message: string) => {
    if (problem === "sign-in" || problem === "denied") {
      const note = problem === "denied" ? "denied" : "expired";
      setSignInHint(false);
      setAccount({ kind: "anonymous", note });
      setNotice(text.account.notes[note]);
      return;
    }
    if (problem === "offline") {
      setNotice(text.account.offline);
      return;
    }
    if (problem === "unavailable") {
      setNotice(text.account.unavailable);
      return;
    }
    console.warn("AI request failed:", message);
    setNotice(text.ai.failed);
  }, []);

  const callAi = useCallback(async <T,>(body: unknown, quiet = false): Promise<T | null> => {
    const outcome: ApiOutcome<T> = await callApi<T>("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (outcome.ok) return outcome.value;
    if (quiet && outcome.problem === "error") {
      console.warn("AI request failed:", outcome.message);
      return null;
    }
    noteApiProblem(outcome.problem === "error" ? "error" : outcome.problem, outcome.message);
    return null;
  }, [noteApiProblem]);

  const replaceProject = useCallback((next: Project) => {
    if (projectRef.current?.id === next.id) projectRef.current = next;
    setProjects((current) => current.map((item) => (item.id === next.id ? next : item)));
  }, []);

  /**
   * One write path for the project, in order. Structural changes (the file tree,
   * the design card, undo) save right away; text editing is coalesced by the
   * debounce below, where a few hundred milliseconds is a keystroke, not data.
   */
  const queueSave = useCallback((next: Project) => {
    setSaveState("saving");
    saveChain.current = saveChain.current
      .then(() => saveProject(next))
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("error"));
  }, []);

  const flushSave = useCallback(() => {
    if (pendingSave.current.timer !== null) {
      window.clearTimeout(pendingSave.current.timer);
      pendingSave.current.timer = null;
    }
    const pending = pendingSave.current.project;
    pendingSave.current.project = null;
    if (pending) queueSave(pending);
  }, [queueSave]);

  /** Applies a structural change and saves it now. */
  const commit = useCallback(
    (next: Project) => {
      replaceProject(next);
      flushSave();
      queueSave(next);
    },
    [flushSave, queueSave, replaceProject],
  );

  /** Ask the Worker how much the model can take, so 自动 mode is not a guess. */
  useEffect(() => {
    if (account.kind !== "signed-in") return;
    let cancel = false;
    void fetch("/api/ai", { credentials: "same-origin", redirect: "manual" })
      .then((response) => (response.ok ? response.json() : null))
      .then((info: { contextTokens?: number } | null) => {
        if (cancel || !info || typeof info.contextTokens !== "number") return;
        setModelLimit(info.contextTokens);
      })
      .catch(() => {
        // Offline or refused: 自动 falls back to the built-in assumption.
      });
    return () => {
      cancel = true;
    };
  }, [account.kind]);

  useEffect(() => {
    if (!project) {
      setRemembers(false);
      return;
    }
    let cancel = false;
    void projectHasSession(project.id)
      .then((has) => {
        if (!cancel) setRemembers(has);
      })
      .catch(() => {
        if (!cancel) setRemembers(false);
      });
    return () => {
      cancel = true;
    };
  }, [project?.id]);

  useEffect(() => {
    budgetRef.current = budgetFor(settings.agentBudget, modelLimit).tokens;
    forgetAllRunners();
  }, [settings.agentBudget, modelLimit]);

  useEffect(() => {
    if (!ready || !project) return;
    setSaveState("saving");
    pendingSave.current.project = project;
    pendingSave.current.timer = window.setTimeout(() => flushSave(), 350);
    return () => {
      if (pendingSave.current.timer !== null) {
        window.clearTimeout(pendingSave.current.timer);
        pendingSave.current.timer = null;
      }
    };
  }, [project, ready, flushSave]);

  /** Closing the tab or switching away must not drop the last keystrokes. */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [flushSave]);

  const staticProblems = useMemo(() => (project ? diagnoseProject(project) : []), [project]);
  const problems = useMemo(() => [...staticProblems, ...runtimeProblems], [staticProblems, runtimeProblems]);

  const updateText = useCallback(
    (filePath: string, text: string) => {
      if (!project) return;
      const current = project.files.find((file) => file.path === filePath);
      if (current?.text === text) return;
      replaceProject(upsertFile(project, { path: filePath, text }));
    },
    [project, replaceProject],
  );

  const remember = useCallback((target = projectRef.current) => {
    if (!target) return;
    setUndoStack((stack) => [...stack, { projectId: target.id, files: target.files, design: target.design, trash: target.trash }].slice(-20));
  }, []);

  const openPixelEditor = useCallback((open: PixelOpen) => {
    const current = projectRef.current;
    if (!current) return;
    pixelCount.current += 1;
    setPixelNewOpen(false);
    setMapNewOpen(false);
    setMapSession(null);
    setPixelSession({ ...open, id: pixelCount.current, projectId: current.id });
  }, []);

  const startPixelNew = useCallback(
    (input: PixelNewInput) => {
      const current = projectRef.current;
      const size = checkSize(input.width, input.height);
      const path = imagePath(input.path);
      if (!current || !size.ok || !path || current.files.some((file) => file.path === path)) return false;
      if (input.background !== null && !parseHex(input.background)) return false;
      openPixelEditor({ source: "new", path, width: size.width, height: size.height, background: input.background });
      return true;
    },
    [openPixelEditor],
  );

  const editPixelFile = useCallback(
    (filePath: string) => {
      const current = projectRef.current;
      const file = current?.files.find((item) => item.path === filePath);
      if (!file?.bytes || !canEditPixels(file.path)) return false;
      const sidecar = animationSidecarPath(file.path);
      const note = sidecar ? current?.files.find((item) => item.path === sidecar) : undefined;
      openPixelEditor({ source: "file", path: file.path, bytes: new Uint8Array(file.bytes), animText: note?.text ?? null });
      return true;
    },
    [openPixelEditor],
  );

  const editDraftPixels = useCallback(() => {
    const current = projectRef.current;
    if (!current || !assetDraft || assetDraft.sound) return;
    const chosen = uniquePath(
      current.files.map((file) => file.path),
      imagePath(assetDraft.suggested) ?? "assets/my-image.png",
    );
    setAssetOpen(false);
    openPixelEditor({ source: "draft", path: chosen, bytes: new Uint8Array(assetDraft.bytes) });
  }, [assetDraft, openPixelEditor]);

  const closePixelEditor = useCallback(() => {
    setPixelSession(null);
    // A generated picture the child was touching up goes back to the result they came from.
    if (pixelSessionRef.current?.source === "draft" && assetDraftRef.current) setAssetOpen(true);
  }, []);

  const savePixelImage = useCallback(
    async (input: PixelSaveInput): Promise<PixelSaveResult> => {
      const session = pixelSessionRef.current;
      const base = projectRef.current;
      const plan = planPixelSave(base, session?.projectId ?? null, input);
      if (!base || !plan.ok) return plan.ok ? { ok: false, reason: "no-project" } : plan;
      // Pending text edits go to disk first, so the write below is the newest state.
      flushSave();
      const written = saveChain.current.then(() => saveProject(plan.next));
      saveChain.current = written.then(
        () => undefined,
        () => undefined,
      );
      try {
        await written;
      } catch (error) {
        console.warn("Saving the picture failed:", error);
        return { ok: false, reason: "write-failed" };
      }
      setUndoStack((stack) => [...stack, { projectId: base.id, files: base.files, design: base.design, trash: base.trash }].slice(-20));
      setProjects((current) =>
        current.map((item) => {
          if (item.id !== base.id) return item;
          const withPicture = upsertFile(item, { path: plan.path, bytes: input.bytes });
          return input.sidecar ? upsertFile(withPicture, { path: input.sidecar.path, text: input.sidecar.text }) : withPicture;
        }),
      );
      setPath(plan.path);
      if (session?.source === "draft") {
        assetDraftRef.current = null;
        setAssetDraft(null);
      }
      return { ok: true, path: plan.path };
    },
    [flushSave],
  );

  const saveAnimExample = useCallback(
    async (input: AnimExampleInput): Promise<AnimExampleResult> => {
      const session = pixelSessionRef.current;
      const base = projectRef.current;
      const plan = planAnimExample(base, session?.projectId ?? null, input);
      if (!base || !plan.ok) return plan.ok ? { ok: false, reason: "no-project" } : plan;
      if (!plan.changed) return { ok: true, changed: false, module: plan.module, main: plan.main };
      flushSave();
      const written = saveChain.current.then(() => saveProject(plan.next));
      saveChain.current = written.then(
        () => undefined,
        () => undefined,
      );
      try {
        await written;
      } catch (error) {
        console.warn("Saving the animation example failed:", error);
        return { ok: false, reason: "write-failed" };
      }
      setUndoStack((stack) => [...stack, { projectId: base.id, files: base.files, design: base.design, trash: base.trash }].slice(-20));
      setProjects((current) =>
        current.map((item) => {
          if (item.id !== base.id) return item;
          let next = item;
          if (plan.module === "wrote") {
            const moduleFile = plan.next.files.find((file) => file.path === "sprite_anim.py");
            if (moduleFile?.text) next = upsertFile(next, { path: moduleFile.path, text: moduleFile.text });
          }
          if (plan.main) {
            const mainFile = plan.next.files.find((file) => file.path === "main.py");
            if (mainFile?.text) next = upsertFile(next, { path: "main.py", text: mainFile.text });
          }
          return next;
        }),
      );
      if (plan.main) setPath("main.py");
      return { ok: true, changed: true, module: plan.module, main: plan.main };
    },
    [flushSave],
  );

  const openMapEditor = useCallback((open: MapOpen) => {
    const current = projectRef.current;
    if (!current) return;
    mapCount.current += 1;
    setMapNewOpen(false);
    setPixelNewOpen(false);
    setPixelSession(null);
    setMapSession({ ...open, id: mapCount.current, projectId: current.id });
  }, []);

  const startMapNew = useCallback(
    (input: MapNewInput) => {
      const current = projectRef.current;
      if (!current || !isMapSlug(input.slug) || !cleanMapName(input.name) || !createMap(input)) return false;
      if (input.tilesetPng) {
        const decoded = decodePng(input.tilesetPng);
        const columns = input.tilesetColumns ?? 0;
        const rows = input.tilesetRows ?? 0;
        if (!decoded.ok || decoded.pixels.width !== input.tileWidth * columns || decoded.pixels.height !== input.tileHeight * rows) return false;
      }
      const paths = [mapDocumentPath(input.slug), tilesetPath(input.slug), collisionCsvPath(input.slug), layerCsvPath(input.slug, "ground")];
      if (paths.some((path) => !path || current.files.some((file) => file.path === path))) return false;
      openMapEditor({ source: "new", ...input });
      return true;
    },
    [openMapEditor],
  );

  const editMapFile = useCallback(
    (filePath: string) => {
      const current = projectRef.current;
      const slug = slugFromDocumentPath(filePath);
      if (!current || !slug) return false;
      const prefix = `maps/${slug}.`;
      const files = current.files
        .filter((file) => file.path === filePath || file.path.startsWith(prefix))
        .map((file) => ({ path: file.path, text: file.text, bytes: file.bytes ? new Uint8Array(file.bytes) : undefined }));
      if (!files.some((file) => file.path === filePath && typeof file.text === "string")) return false;
      openMapEditor({ source: "file", path: filePath, files });
      return true;
    },
    [openMapEditor],
  );

  const closeMapEditor = useCallback(() => {
    setMapSession(null);
  }, []);

  const saveSound = useCallback(
    async (input: SoundSaveInput): Promise<SoundSaveResult> => {
      const base = projectRef.current;
      if (!base) return { ok: false, reason: "no-project" };
      const plan = planSoundSave(base, input);
      if (!plan.ok) return plan;
      if (!plan.changed) return { ok: true, path: plan.path, changed: false };
      flushSave();
      const written = saveChain.current.then(() => saveProject(plan.next));
      saveChain.current = written.then(
        () => undefined,
        () => undefined,
      );
      try {
        await written;
      } catch (error) {
        console.warn("Saving the sound failed:", error);
        return { ok: false, reason: "write-failed" };
      }
      setUndoStack((stack) => [...stack, { projectId: base.id, files: base.files, design: base.design, trash: base.trash }].slice(-20));
      if (projectRef.current?.id === plan.next.id) projectRef.current = plan.next;
      setProjects((current) => current.map((item) => (item.id === plan.next.id ? plan.next : item)));
      setPath(input.mainText !== undefined ? "main.py" : plan.path);
      return { ok: true, path: plan.path, changed: true };
    },
    [flushSave],
  );

  const keepSound = useCallback(async (input: { bytes: Uint8Array; title: string; kind: SoundKind; tags: string[] }) => {
    const outcome = await keepSoundRecord(input);
    if (outcome.ok) setSoundLibraryVersion((version) => version + 1);
    return outcome.ok ? { ok: true as const } : { ok: false as const, reason: outcome.reason };
  }, []);

  const forgetKeptSound = useCallback(async (id: string) => {
    await forgetKeptRecord(id);
    setSoundLibraryVersion((version) => version + 1);
  }, []);

  const saveMap = useCallback(
    async (input: MapSaveInput): Promise<MapSaveResult> => {
      const session = mapSessionRef.current;
      const base = projectRef.current;
      const plan = planMapSave(base, session?.projectId ?? null, input);
      if (!base || !plan.ok) return plan.ok ? { ok: false, reason: "no-project" } : plan;
      flushSave();
      const written = saveChain.current.then(() => saveProject(plan.next));
      saveChain.current = written.then(
        () => undefined,
        () => undefined,
      );
      try {
        await written;
      } catch (error) {
        console.warn("Saving the map failed:", error);
        return { ok: false, reason: "write-failed" };
      }
      setUndoStack((stack) => [...stack, { projectId: base.id, files: base.files, design: base.design, trash: base.trash }].slice(-20));
      if (projectRef.current?.id === plan.next.id) projectRef.current = plan.next;
      setProjects((current) => current.map((item) => (item.id === plan.next.id ? plan.next : item)));
      setPath(plan.documentPath);
      return { ok: true, path: plan.documentPath };
    },
    [flushSave],
  );

  const saveMapExample = useCallback(
    async (input: MapExampleInput): Promise<MapExampleResult> => {
      const session = mapSessionRef.current;
      const base = projectRef.current;
      const plan = planMapExample(base, session?.projectId ?? null, input);
      if (!base || !plan.ok) return plan.ok ? { ok: false, reason: "no-project" } : plan;
      if (!plan.changed) return { ok: true, changed: false, module: plan.module, main: plan.main };
      flushSave();
      const written = saveChain.current.then(() => saveProject(plan.next));
      saveChain.current = written.then(
        () => undefined,
        () => undefined,
      );
      try {
        await written;
      } catch (error) {
        console.warn("Saving the map example failed:", error);
        return { ok: false, reason: "write-failed" };
      }
      setUndoStack((stack) => [...stack, { projectId: base.id, files: base.files, design: base.design, trash: base.trash }].slice(-20));
      if (projectRef.current?.id === plan.next.id) projectRef.current = plan.next;
      setProjects((current) => current.map((item) => (item.id === plan.next.id ? plan.next : item)));
      if (plan.main) setPath("main.py");
      return { ok: true, changed: true, module: plan.module, main: plan.main };
    },
    [flushSave],
  );

  /** Resolves the candidate preview that is waiting for evidence, if any. */
  const settleRun = useCallback((outcome: RunOutcome) => {
    const pending = pendingRun.current;
    if (!pending) return false;
    window.clearTimeout(pending.timer);
    pendingRun.current = null;
    pending.resolve(outcome);
    return true;
  }, []);

  const stop = useCallback(() => {
    previewGeneration.current += 1;
    previewActive.current = false;
    runtimeError.current = false;
    const session = activePlaySession.current;
    activePlaySession.current = null;
    previewArchive.current = null;
    if (session) {
      void discardPlay(session).catch((error: unknown) => console.warn("Preview cleanup failed:", error));
    }
    setFrameSrc("about:blank");
    setFrameHtml("");
    setRunState((state) => (state === "idle" ? state : "stopped"));
    setStatusNote(text.stage.stopped);
    // Stopping mid-check means we have no evidence; never a code problem.
    settleRun({ kind: "quiet" });
  }, [settleRun]);

  /** Publishes a build to the stage. Throws when the preview cannot start. */
  const runProject = useCallback(async (target: Project, owner: StageOwner) => {
    const generation = ++previewGeneration.current;
    previewActive.current = false;
    runtimeError.current = false;
    previewArchive.current = null;
    if (!target.files.some((file) => file.path === "main.py" && file.text?.trim())) {
      throw new Error(text.stage.needMain);
    }
    const previousSession = activePlaySession.current;
    activePlaySession.current = null;
    if (previousSession) void discardPlay(previousSession).catch((error: unknown) => console.warn("Preview cleanup failed:", error));
    setMenu(null);
    setRunState("starting");
    consoleRef.current = "";
    setConsoleText("");
    setRuntimeProblems([]);
    setFps(null);
    setFrameMs(null);
    setInputs([]);
    setStatusNote(text.stage.preparing);
    setFrameSrc("about:blank");
    setFrameHtml("");
    setStageOwner(owner);
    await ensurePlayerServiceWorker();
    if (generation !== previewGeneration.current) return;
    const bundle = buildWebBundle(target, { template, preview: true });
    const session = crypto.randomUUID();
    await publishPlay(session, bundle);
    if (generation !== previewGeneration.current) {
      await discardPlay(session);
      return;
    }
    activePlaySession.current = session;
    previewArchive.current = bundle.apk;
    previewActive.current = true;
    setFrameSrc("about:srcdoc");
    setFrameHtml(bundle.html);
    setStatusNote(text.stage.loading);
  }, []);

  const run = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    const generation = previewGeneration.current + 1;
    try {
      await runProject(current, "current");
    } catch (error) {
      if (generation !== previewGeneration.current) return;
      setRunState("error");
      setStatusNote(text.stage.failed);
      setNotice(error instanceof Error ? error.message : text.stage.failed);
      setBottomTab("console");
    }
  }, [runProject]);

  /** The agent loop's run step: start a candidate and wait for evidence. */
  const runCandidate = useCallback(
    (candidate: Project, turn: AgentTurnInput): Promise<RunOutcome> => {
      return new Promise<RunOutcome>((resolve) => {
        const timer = window.setTimeout(() => settleRun({ kind: "quiet" }), RUN_EVIDENCE_MS);
        pendingRun.current = { turnId: turn.id, resolve, timer };
        const generation = previewGeneration.current + 1;
        void runProject(candidate, "candidate").catch((error: unknown) => {
          if (generation !== previewGeneration.current) return;
          settleRun({
            kind: "unavailable",
            detail: error instanceof Error ? error.message : "The preview could not start.",
          });
        });
      });
    },
    [runProject, settleRun],
  );

  const noteConsole = useCallback(
    (chunk: string) => {
      if (!previewActive.current) return;
      const next = (consoleRef.current + chunk).slice(-20_000);
      consoleRef.current = next;
      setConsoleText(next);
      const found = problemsFromConsole(next);
      if (found.length) {
        runtimeError.current = true;
        setRuntimeProblems(found);
        setRunState("error");
        setStatusNote(text.stage.runtimeError);
        setBottomTab("problems");
        settleRun({ kind: "error", detail: tracebackTail(next) });
      }
    },
    [settleRun],
  );

  const callModel = useCallback(
    async (messages: ChatMessage[]): Promise<string> => {
      // One ADK run per step: ADK owns the project's conversation and its token
      // budget, the gateway owns the key and the model call.
      const base = projectRef.current;
      const runner = projectRunner({
        system: messages[0]?.content as string,
        sessionId: base?.id ?? "scratch",
        budgetTokens: budgetRef.current,
      });
      // Our loop writes text, or text plus pictures. ADK wants its own parts, so
      // pictures become inline data instead of being dropped.
      const stepParts = toAdkParts(messages[1]?.content);
      try {
        return await runner.run(stepParts);
      } catch (error) {
        if (error instanceof GatewayError) {
          noteApiProblem(error.problem === "failed" ? "error" : error.problem, error.problem);
          throw error;
        }
        console.warn("Model call failed:", error);
        throw new Error("The model did not answer.");
      }
    },
    [noteApiProblem],
  );

  const startTurn = useCallback(
    async (request: string, images?: ChatImage[]) => {
      const base = projectRef.current;
      if (!base) return;
      if (account.kind !== "signed-in") {
        setNotice(text.ai.needsSignIn);
        return;
      }
      const turnId = crypto.randomUUID();
      const fresh: Turn = {
        id: turnId,
        kind: "design",
        request: request.trim(),
        images: images?.map((image) => image.dataUrl),
        steps: [],
        say: "",
        adopted: false,
        discarded: false,
      };
      setTurns((list) => [...list, fresh]);
      turnRef.current = { id: turnId, projectId: base.id, cancelled: false };
      setTurnBusy(true);
      setNotice("");
      const patch = (change: (turn: Turn) => Turn) =>
        setTurns((list) => list.map((item) => (item.id === turnId ? change(item) : item)));
      let catalog: Awaited<ReturnType<typeof hitsFromPacks>> = [];
      try {
        catalog = hitsFromPacks(await loadLibrary());
      } catch (error) {
        console.warn("Asset catalog did not load:", error);
      }
      let outcome: AgentTurnOutcome;
      try {
        outcome = await runAgentTurn({ id: turnId, request: fresh.request, images, catalog }, base, {
          model: callModel,
          diagnose: diagnoseProject,
          run: runCandidate,
          cancelled: () =>
            turnRef.current?.id !== turnId || turnRef.current.cancelled || projectRef.current?.id !== base.id,
          emit: (event) => patch((item) => applyEvent(item, event)),
          attachAssets: async (project, assets) => {
            let next = project;
            for (const asset of assets) {
              const copy = await resolveCatalogCopy(asset.packId, asset.assetId);
              if (!copy) throw new Error("Unknown library asset.");
              const applied = await materializeAsset(next, copy);
              if (!applied.ok && applied.reason !== "identical") {
                throw new Error("Refusing to overwrite a library file the child already has.");
              }
              if (applied.ok) next = applied.project;
            }
            return next;
          },
        });
      } catch (error) {
        outcome = { kind: "failed", message: error instanceof Error ? error.message : "The model call failed." };
      }
      patch((item) => ({ ...item, outcome }));
      if (outcome.kind === "failed") console.warn("Agent round failed:", outcome.message);
      if (outcome.kind === "ready" && viewRef.current === "code") setNotice(text.pane.doneNotice);
      if (turnRef.current?.id === turnId) turnRef.current = null;
      setTurnBusy(false);
    },
    [account.kind, callModel, runCandidate],
  );

  const cancelTurn = useCallback(() => {
    if (!turnRef.current && !pendingRun.current) return;
    if (turnRef.current) turnRef.current.cancelled = true;
    settleRun({ kind: "cancelled" });
    setStageOwner((owner) => {
      if (owner === "candidate") stop();
      return "current";
    });
  }, [settleRun, stop]);

  /** Cancels a round because the child or a project switch moved on. */
  const abortTurn = useCallback(() => {
    if (turnRef.current) turnRef.current.cancelled = true;
    settleRun({ kind: "cancelled" });
    setTurnBusy(false);
  }, [settleRun]);

  const activeTurn = turns.at(-1) ?? null;
  /** The step the loop is on right now, for the live status in the UI. */
  const activeStep = activeTurn?.steps.filter((step) => step.status === "active").at(-1);
  const candidate = activeTurn && !activeTurn.adopted && !activeTurn.discarded ? activeTurn.candidate ?? null : null;
  const canTurn = account.kind === "signed-in" && !!project && !turnBusy;

  const adoptCandidate = useCallback(() => {
    const turn = turns.at(-1);
    const target = projectRef.current;
    if (!turn?.candidate || !target || turn.candidate.project.id !== target.id) return;
    if (turn.adopted || turn.discarded) return;
    if (turn.outcome?.kind !== "ready") return;
    if (turn.id.startsWith("collab-")) {
      const candidateId = turn.id.slice("collab-".length);
      collabSettledRef.current.push({ candidateId, adopted: true });
    }
    remember();
    commit({
      ...target,
      files: turn.candidate.project.files,
      design: turn.candidate.design,
      updatedAt: Date.now(),
    });
    setTurns((list) => list.map((item) => (item.id === turn.id ? { ...item, adopted: true } : item)));
    setStageOwner("current");
  }, [commit, remember, turns]);

  const discardCandidate = useCallback(() => {
    const turn = turns.at(-1);
    if (!turn?.candidate) return;
    if (turn.id.startsWith("collab-")) {
      const candidateId = turn.id.slice("collab-".length);
      collabSettledRef.current.push({ candidateId, adopted: false });
    }
    setTurns((list) => list.map((item) => (item.id === turn.id ? { ...item, discarded: true } : item)));
    setStageOwner((owner) => {
      if (owner === "candidate") stop();
      return "current";
    });
  }, [stop, turns]);

  const explainSelection = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    if (account.kind !== "signed-in") {
      setNotice(text.ai.needsSignIn);
      return;
    }
    const file = current.files.find((item) => item.path === path);
    if (!file || file.bytes) return;
    const turnId = crypto.randomUUID();
    setTurns((list) => [
      ...list,
      {
        id: turnId,
        kind: "explain",
        request: selection.trim() ? `${path} 里选中的代码` : path,
        steps: [],
        say: "",
        adopted: false,
        discarded: false,
      },
    ]);
    setView("design");
    setAiBusy(true);
    try {
      const answer = readSay(
        await callModel(explainMessages({ path, source: file.text ?? "", selection })),
      );
      setTurns((list) => list.map((item) => (item.id === turnId ? { ...item, answer } : item)));
    } catch (error) {
      console.warn("Explain failed:", error);
      setTurns((list) => list.map((item) => (item.id === turnId ? { ...item, answer: text.ai.failed } : item)));
    } finally {
      setAiBusy(false);
    }
  }, [account.kind, callModel, path, selection]);

  const [collabActive, setCollabActive] = useState(false);
  const collabSettledRef = useRef<{ candidateId: string; adopted: boolean }[]>([]);
  const handledCandidateIdsRef = useRef<Set<string>>(new Set());

  const collabUrl = useMemo(() => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/mcp`;
    }
    return "https://gamekit.talkincode.net/mcp";
  }, []);

  const makeCollabSnapshot = useCallback((target: Project) => {
    return {
      projectId: target.id,
      name: target.name,
      files: target.files.map((file) => {
        if (typeof file.bytes === "number") return { path: file.path, bytes: file.bytes };
        return { path: file.path, text: file.text ?? "" };
      }),
    };
  }, []);

  const startCollab = useCallback(async (): Promise<boolean> => {
    if (account.kind !== "signed-in") {
      setNotice(text.collab.needsSignIn);
      return false;
    }
    const current = projectRef.current;
    if (!current) {
      setNotice(text.collab.needsProject);
      return false;
    }
    const outcome = await callApi<{ session: string }>("/api/collab/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: makeCollabSnapshot(current) }),
    });
    if (!outcome.ok) {
      setNotice(outcome.message);
      return false;
    }
    collabSettledRef.current = [];
    handledCandidateIdsRef.current.clear();
    setCollabActive(true);
    return true;
  }, [account.kind, makeCollabSnapshot]);

  const stopCollab = useCallback(async (): Promise<void> => {
    setCollabActive(false);
    collabSettledRef.current = [];
    handledCandidateIdsRef.current.clear();
    await callApi("/api/collab/stop", { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!collabActive || account.kind !== "signed-in") return;
    let cancelled = false;

    const poll = async () => {
      const current = projectRef.current;
      if (!current || cancelled) return;
      const settled = collabSettledRef.current.splice(0);
      const outcome = await callApi<{
        candidates: {
          id: string;
          tool: string;
          say: string;
          files: { path: string; text: string }[];
          assets?: { packId: string; assetId: string }[];
          createdAt: number;
        }[];
        activity: { at: number; tool: string; summary: string }[];
      }>("/api/collab/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot: makeCollabSnapshot(current),
          settled,
        }),
      });

      if (cancelled) return;

      if (!outcome.ok) {
        if (settled.length) collabSettledRef.current.unshift(...settled);
        if (outcome.problem === "sign-in" || outcome.problem === "denied") {
          setCollabActive(false);
        }
        return;
      }

      const open = outcome.value.candidates ?? [];
      for (const cand of open) {
        if (handledCandidateIdsRef.current.has(cand.id)) continue;
        handledCandidateIdsRef.current.add(cand.id);

        let candidateProject = current;
        let refused = "";
        for (const asset of cand.assets ?? []) {
          const copy = await resolveCatalogCopy(asset.packId, asset.assetId);
          if (!copy) {
            refused = text.recipes.assetMissing;
            break;
          }
          const applied = await materializeAsset(candidateProject, copy);
          if (!applied.ok && applied.reason !== "identical") {
            refused = text.recipes.assetConflict;
            break;
          }
          if (applied.ok) candidateProject = applied.project;
        }
        if (!refused) {
          for (const file of cand.files) {
            if (candidateProject.files.some((item) => item.path === file.path && item.bytes)) {
              refused = text.recipes.assetConflict;
              break;
            }
            candidateProject = upsertFile(candidateProject, { path: file.path, text: file.text });
          }
        }
        if (refused) {
          collabSettledRef.current.push({ candidateId: cand.id, adopted: false });
          setNotice(refused);
          continue;
        }
        const addedBinary = candidateProject.files.some(
          (file) => file.bytes && !current.files.some((item) => item.path === file.path && item.bytes),
        );
        const diff = candidateDiff(current, candidateProject);
        if (diff.length === 0 && !addedBinary) continue;

        const candidateResult: CandidateResult = {
          project: candidateProject,
          design: current.design ?? { title: current.name, hero: "", goal: "", controls: [], look: "" },
          say: cand.say || text.collab.candidateSay,
          repairs: 0,
          diff,
        };

        const turnId = `collab-${cand.id}`;
        const newTurn: Turn = {
          id: turnId,
          kind: "design",
          request: text.collab.candidateRequest(cand.tool),
          steps: [
            {
              key: "collab",
              kind: "finish",
              status: "done",
              detail: cand.say || "收到外部助手修改建议",
            },
          ],
          say: cand.say || text.collab.candidateSay,
          candidate: candidateResult,
          outcome: { kind: "ready" },
          adopted: false,
          discarded: false,
        };

        setTurns((list) => [...list, newTurn]);
        setView("design");
        void runProject(candidateProject, "candidate").catch(() => {});
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, 2500);

    const initialTimer = setTimeout(() => {
      void poll();
    }, 200);

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(initialTimer);
    };
  }, [collabActive, account.kind, makeCollabSnapshot, runProject]);

  const showPreparedCandidate = useCallback((input: { request: string; say: string; project: Project }) => {
    const current = projectRef.current;
    if (!current || input.project.id !== current.id) return;
    const diff = candidateDiff(current, input.project);
    const addedBinary = input.project.files.some(
      (file) => file.bytes && !current.files.some((item) => item.path === file.path && item.bytes),
    );
    if (!diff.length && !addedBinary) {
      setNotice(text.recipes.assetSame);
      return;
    }
    const design = current.design ?? { title: current.name, hero: "", goal: "", controls: [], look: "" };
    const candidateResult: CandidateResult = {
      project: input.project,
      design,
      say: input.say,
      repairs: 0,
      diff,
    };
    const turn: Turn = {
      id: crypto.randomUUID(),
      kind: "design",
      request: input.request,
      steps: [{ key: "finish", kind: "finish", status: "done" }],
      say: input.say,
      design,
      candidate: candidateResult,
      outcome: { kind: "ready" },
      adopted: false,
      discarded: false,
    };
    setTurns((list) => [...list, turn]);
    setView("design");
    setRecipesOpen(false);
    setChallengeOpen(false);
    setLibraryOpen(false);
  }, []);

  const newRecipe = useCallback((id: string, challenge = false) => {
    const created = createRecipeProject(id);
    if (!created) return;
    flushSave();
    void saveProject(created);
    stop();
    abortTurn();
    setProjects((current) => [created, ...current]);
    setActiveId(created.id);
    setTurns([]);
    localStorage.setItem(ACTIVE_KEY, created.id);
    setPath("main.py");
    setRecipesOpen(false);
    setChallengeOpen(challenge);
    setNotice("");
  }, [abortTurn, flushSave, stop]);

  const offerLessonCandidate = useCallback((recipeId: string) => {
    const current = projectRef.current;
    const lesson = lessonFor(recipeId);
    if (!current || !lesson || recipeIdOf(current.files) !== recipeId) return;
    if (turnBusy) {
      setNotice(text.recipes.busy);
      return;
    }
    const next = upsertFile(current, { path: lesson.suggestion.path, text: lesson.suggestion.content });
    showPreparedCandidate({ request: lesson.goal, say: lesson.suggestion.say, project: next });
  }, [showPreparedCandidate, turnBusy]);

  const proposeCatalogAsset = useCallback(async (packId: string, assetId: string) => {
    const current = projectRef.current;
    if (!current) {
      setNotice(text.recipes.needProject);
      return;
    }
    if (turnBusy) {
      setNotice(text.recipes.busy);
      return;
    }
    const copy = await resolveCatalogCopy(packId, assetId);
    if (!copy) {
      setNotice(text.recipes.assetMissing);
      return;
    }
    const applied = await materializeAsset(current, copy);
    if (!applied.ok) {
      setNotice(applied.reason === "identical" ? text.recipes.assetSame : text.recipes.assetConflict);
      return;
    }
    showPreparedCandidate({
      request: text.recipes.assetRequest(copy.title),
      say: text.recipes.assetSay(applied.path),
      project: applied.project,
    });
  }, [showPreparedCandidate, turnBusy]);

  const value = useMemo<StudioValue>(() => {
    const requireProject = () => {
      if (!project) throw new Error("No project is open.");
      return project;
    };
    return {
      ready,
      account,
      signIn: () => location.assign(LOGIN_PATH),
      signOut: () => {
        void stopCollab();
        setSignInHint(false);
        location.assign(LOGOUT_PATH);
      },
      project,
      projects,
      path,
      setPath: (next) => {
        setPath(next);
        setSelection("");
      },
      saveState,
      runState,
      frameSrc,
      frameHtml,
      sendPreviewArchive: (target) => {
        const archive = previewArchive.current;
        if (!archive || !target) return;
        const bytes = new ArrayBuffer(archive.byteLength);
        new Uint8Array(bytes).set(archive);
        target.postMessage({ source: "gamekit", type: "archive", bytes }, "*", [bytes]);
      },
      stageOwner,
      consoleText,
      statusNote,
      fps,
      frameMs,
      inputs,
      problems,
      selection,
      setSelection,
      menu,
      setMenu,
      remembers,
      settings,
      updateSettings: (next) => {
        saveSettings(next);
        setSettings(next);
      },
      modelLimit,
      settingsOpen,
      setSettingsOpen,
      collabActive,
      collabUrl,
      startCollab,
      stopCollab,
      projectsOpen,
      setProjectsOpen,
      view,
      setView,
      panels,
      togglePanel: (panel) => {
        setPanels((current) => {
          const next = { ...current, [panel]: !current[panel] };
          writePanels(next);
          return next;
        });
      },
      turns,
      candidate,
      turnBusy,
      activeStep,
      canTurn,
      startTurn,
      cancelTurn,
      adoptCandidate,
      discardCandidate,
      explainSelection,
      assetDraft,
      assetKind,
      setAssetKind,
      assetSize,
      setAssetSize,
      assetCut,
      setAssetCut,
      assetOpen,
      setAssetOpen,
      soundOpen,
      setSoundOpen,
      soundKind,
      setSoundKind,
      soundRecipe,
      clearSoundRecipe: () => setSoundRecipe(null),
      saveSound,
      keepSound,
      forgetKeptSound,
      soundLibraryVersion,
      aiBusy,
      notice,
      dismissNotice: () => setNotice(""),
      bottomTab,
      setBottomTab,
      updateText,
      createFile: (raw) => {
        const next = normalizePath(raw);
        if (!project || !next) {
          setNotice(text.code.badPath);
          return false;
        }
        if (project.files.some((file) => file.path === next)) {
          setPath(next);
          setNotice(text.code.pathTaken);
          return false;
        }
        remember();
        commit(upsertFile(project, { path: next, text: "" }));
        setPath(next);
        return true;
      },
      trashFile: (target) => {
        if (!project) return;
        if (!project.files.some((file) => file.path === target)) return;
        remember();
        const next = trashFile(project, target);
        commit(next);
        if (path === target) {
          setPath(next.files.some((file) => file.path === "main.py") ? "main.py" : next.files[0]?.path ?? "main.py");
        }
        setNotice(text.code.trashed(target));
      },
      restoreFromTrash: (target) => {
        if (!project) return;
        if (!project.trash?.some((item) => item.file.path === target)) return;
        remember();
        const next = restoreFile(project, target);
        commit(next);
        const back = next.files.find((file) => !project.files.some((item) => item.path === file.path));
        setPath(back?.path ?? next.files[0]?.path ?? "main.py");
        setNotice(text.code.restored(target));
      },
      dropFromTrash: (target) => {
        if (!project) return;
        commit(dropFromTrash(project, target));
      },
      emptyTrash: () => {
        if (!project?.trash?.length) return;
        remember();
        commit(emptyTrash(project));
        setNotice(text.code.trashEmptied);
      },
      renameCurrent: (from, raw) => {
        if (!project || from !== path) return false;
        const next = normalizePath(raw);
        if (!next || next === from) return false;
        const renamed = renameFile(project, from, next);
        if (!renamed) {
          setNotice(text.code.pathTaken);
          return false;
        }
        remember();
        commit(renamed);
        setPath(next);
        return true;
      },
      addBytes: (raw, bytes) => {
        const current = projectRef.current;
        if (!current) return;
        const next = normalizePath(raw);
        if (!next) {
          setNotice(text.code.badPath);
          return;
        }
        const chosen = uniquePath(
          current.files.map((file) => file.path),
          next,
        );
        remember(current);
        commit(upsertFile(current, { path: chosen, bytes }));
        setPath(chosen);
      },
      importArchive: async (file) => {
        const archive = new Uint8Array(await file.arrayBuffer());
        const imported = projectFromArchive(file.name, archive);
        await saveProject(imported);
        flushSave();
        stop();
        abortTurn();
        setProjects((current) => [imported, ...current]);
        setActiveId(imported.id);
        setProjectsOpen(false);
        setTurns([]);
        localStorage.setItem(ACTIVE_KEY, imported.id);
        setPath(imported.files.some((item) => item.path === "main.py") ? "main.py" : imported.files[0].path);
        setNotice("");
        stop();
      },
      newSample: async () => {
        const created = await createStarterProject(`sample-${projects.length + 1}`);
        await saveProject(created);
        flushSave();
        stop();
        abortTurn();
        setProjects((current) => [created, ...current]);
        setActiveId(created.id);
        setProjectsOpen(false);
        setTurns([]);
        localStorage.setItem(ACTIVE_KEY, created.id);
        setPath("main.py");
        stop();
      },
      newBlank: (name) => {
        flushSave();
        const created = createBlankProject(name.trim() || "untitled");
        void saveProject(created);
        abortTurn();
        setProjects((current) => [created, ...current]);
        setActiveId(created.id);
        setProjectsOpen(false);
        setTurns([]);
        localStorage.setItem(ACTIVE_KEY, created.id);
        setPath("main.py");
        stop();
      },
      openProject: (id) => {
        handledCandidateIdsRef.current.clear();
        flushSave();
        stop();
        abortTurn();
        setActiveId(id);
        setTurns([]);
        setProjectsOpen(false);
        localStorage.setItem(ACTIVE_KEY, id);
        setPath("main.py");
        setMenu(null);
        stop();
      },
      renameProject: (name) => {
        if (!project) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        commit({ ...project, name: trimmed, updatedAt: Date.now() });
      },
      deleteProject: async () => {
        if (!project) return;
        abortTurn();
        stop();
        flushSave();
        await saveChain.current;
        forgetProjectRunner(project.id);
        await deleteStoredProject(project.id);
        const rest = projects.filter((item) => item.id !== project.id);
        if (!rest.length) {
          const created = createBlankProject("untitled");
          await saveProject(created);
          setProjects([created]);
          setActiveId(created.id);
          localStorage.setItem(ACTIVE_KEY, created.id);
        } else {
          setProjects(rest);
          setActiveId(rest[0].id);
          localStorage.setItem(ACTIVE_KEY, rest[0].id);
        }
        setTurns([]);
        setProjectsOpen(false);
        setPath("main.py");
      },
      duplicateProject: async () => {
        if (!project) return;
        const current = projectRef.current;
        if (!current) return;
        flushSave();
        abortTurn();
        stop();
        const copy: Project = {
          ...current,
          id: crypto.randomUUID(),
          name: `${current.name} copy`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          files: current.files.map((file) => ({ ...file, bytes: file.bytes ? file.bytes.slice() : undefined })),
        };
        await saveProject(copy);
        setProjects((current) => [copy, ...current]);
        setTurns([]);
        setActiveId(copy.id);
        setProjectsOpen(false);
        localStorage.setItem(ACTIVE_KEY, copy.id);
      },
      exportSource: () => {
        if (!project) return;
        downloadBytes(`${slugName(project.name)}-source.zip`, sourceZip(project), "application/zip");
      },
      exportKind: (kind) => {
        try {
          const current = requireProject();
          const bundle = buildWebBundle(current, { template, preview: false });
          const slug = slugName(current.name);
          if (kind === "web") downloadBytes(`${slug}-web.zip`, webZip(bundle), "application/zip");
          if (kind === "static") downloadBytes(`${slug}-folder.zip`, staticFolderZip(bundle, current.name), "application/zip");
          if (kind === "itch") downloadBytes(`${slug}-itch.zip`, itchZip(bundle), "application/zip");
          if (kind === "embed") downloadBytes(`${slug}-embed.zip`, embedZip(bundle), "application/zip");
        } catch (error) {
          console.warn("Export build failed:", error);
          setNotice(text.export.buildFailed);
          setBottomTab("problems");
        } finally {
          setMenu(null);
        }
      },
      run,
      stop,
      noteStatus: setStatusNote,
      noteConsole,
      noteReady: () => {
        if (!previewActive.current || runtimeError.current) return;
        setRunState("running");
        setStatusNote(text.stage.running);
        settleRun({ kind: "running" });
      },
      noteTick: (nextFps, nextFrame) => {
        if (!previewActive.current || runtimeError.current) return;
        setFps(nextFps);
        setFrameMs(nextFrame);
        setRunState((state) => (state === "error" ? state : "running"));
        // A frame is proof the game is up, even if the first frame message was late.
        settleRun({ kind: "running" });
      },
      noteInput: (detail) => setInputs((current) => [detail, ...current].slice(0, 12)),
      undo: () => {
        const projectHistory = project ? undoStack.filter((snapshot) => snapshot.projectId === project.id) : [];
        const previous = projectHistory.at(-1);
        if (!project || !previous) return;
        commit({
          ...project,
          files: previous.files,
          design: previous.design,
          trash: previous.trash,
          updatedAt: Date.now(),
        });
        setUndoStack((stack) => {
          const index = stack.lastIndexOf(previous);
          return index < 0 ? stack : stack.filter((_, candidateIndex) => candidateIndex !== index);
        });
      },
      canUndo: !!project && undoStack.some((snapshot) => snapshot.projectId === project.id),
      generateSound: async (promptText) => {
        if (account.kind !== "signed-in") {
          setSoundOpen(false);
          setNotice(text.ai.needsSignIn);
          return;
        }
        variation.current += 1;
        setAiBusy(true);
        setNotice("");
        try {
          const payload = await callAi<{ text?: string }>({ op: "sound", kind: soundKind, prompt: promptText });
          if (!payload?.text) throw new Error("Sound generation failed.");
          // The model chose numbers; we render the samples here, deterministically.
          const spec = readSoundSpec(payload.text, soundKind, soundKind === "sfx" ? "sound" : "music");
          setSoundRecipe({ token: variation.current, spec });
        } catch (error) {
          console.warn("Sound generation failed:", error);
          setNotice(text.ai.soundFailed);
        } finally {
          setAiBusy(false);
        }
      },
      generateAsset: async (promptText) => {
        if (account.kind !== "signed-in") {
          setAssetOpen(false);
          setNotice(text.ai.needsSignIn);
          return;
        }
        variation.current += 1;
        setAiBusy(true);
        setNotice("");
        try {
          const payload = await callAi<{ image?: string; mediaType?: string }>({
            op: "image",
            kind: assetKind,
            prompt: promptText,
            variation: variation.current,
          });
          if (!payload) return;
          if (!payload.image) throw new Error("Image generation failed.");
          const raw = base64ToBytes(payload.image);
          const mediaType = payload.mediaType || "image/jpeg";
          // The picture is resized here, not by the model, so what the child
          // sees in the preview is exactly what lands in assets/.
          const target = assetTarget(assetKind, assetSize, assetCut);
          const prepared = await prepareAsset(raw, mediaType, target);
          const stamp = new Date().toISOString().slice(11, 19).replaceAll(":", "");
          setAssetDraft({
            bytes: prepared.bytes,
            mediaType: "image/png",
            suggested: `assets/${assetKind}-${stamp}.png`,
            width: prepared.width,
            height: prepared.height,
            note: target.cut && prepared.cut < 0.05 ? text.assets.backgroundKept : undefined,
          });
        } catch (error) {
          console.warn("Image generation failed:", error);
          setNotice(text.ai.imageFailed);
        } finally {
          setAiBusy(false);
        }
      },
      acceptAsset: () => {
        if (!project || !assetDraft) return;
        const chosen = uniquePath(
          project.files.map((file) => file.path),
          normalizePath(assetDraft.suggested) ?? `assets/${assetKind}.jpg`,
        );
        remember();
        commit(upsertFile(project, { path: chosen, bytes: assetDraft.bytes }));
        setPath(chosen);
        setAssetDraft(null);
        setAssetOpen(false);
        setSoundOpen(false);
      },
      clearAsset: () => setAssetDraft(null),
      pixelNewOpen,
      setPixelNewOpen,
      libraryOpen,
      setLibraryOpen,
      recipesOpen,
      setRecipesOpen,
      challengeOpen,
      setChallengeOpen,
      newRecipe,
      offerLessonCandidate,
      proposeCatalogAsset,
      copyLibraryAsset: async (request) => {
        const current = projectRef.current;
        if (!current) {
          const missing: LibraryCopyResult = {
            ok: false,
            changed: false,
            path: "",
            code: "no-project",
            pinsSkipped: false,
            exampleSkipped: false,
            project: { id: "", name: "", createdAt: 0, updatedAt: 0, files: [] },
          };
          setNotice(text.library.message(missing));
          return missing;
        }
        const outcome = await applyLibraryCopy(current, request.copy, request.choice, request.example);
        if (outcome.changed) {
          remember(current);
          commit(outcome.project);
          setPath(outcome.examplePath === "main.py" ? "main.py" : outcome.path);
        }
        setNotice(text.library.message(outcome));
        return outcome;
      },
      openLibrarySprite: async (copy, animation, choice) => {
        const current = projectRef.current;
        if (!current) {
          const missing: LibraryCopyResult = {
            ok: false,
            changed: false,
            path: "",
            code: "no-project",
            pinsSkipped: false,
            exampleSkipped: false,
            project: { id: "", name: "", createdAt: 0, updatedAt: 0, files: [] },
          };
          setNotice(text.library.message(missing));
          return missing;
        }
        const outcome = await applyLibraryCopy(current, copy, choice, "none");
        if (!outcome.ok) {
          setNotice(text.library.message(outcome));
          return outcome;
        }
        const side = animationSidecarPath(outcome.path);
        const note = side ? librarySpriteNote(outcome.path, animation) : null;
        let next = outcome.project;
        let changed = outcome.changed;
        if (side && note) {
          const existing = next.files.find((file) => file.path === side);
          if (existing?.text !== note) {
            next = upsertFile(next, { path: side, text: note });
            changed = true;
          }
        }
        if (changed) {
          remember(current);
          commit(next);
          setPath(outcome.path);
        }
        projectRef.current = next;
        setNotice(text.library.message(outcome));
        setLibraryOpen(false);
        editPixelFile(outcome.path);
        return { ...outcome, changed, project: next };
      },
      pixelSession,
      startPixelNew,
      editPixelFile,
      editDraftPixels,
      closePixelEditor,
      savePixelImage,
      saveAnimExample,
      mapNewOpen,
      setMapNewOpen,
      mapSession,
      startMapNew,
      editMapFile,
      closeMapEditor,
      saveMap,
      saveMapExample,
    };
  }, [
    ready,
    account,
    callAi,
    project,
    projects,
    path,
    saveState,
    runState,
    frameSrc,
    frameHtml,
    stageOwner,
    consoleText,
    statusNote,
    fps,
    frameMs,
    inputs,
    problems,
    selection,
    menu,
    remembers,
    settings,
    modelLimit,
    settingsOpen,
    collabActive,
    collabUrl,
    startCollab,
    stopCollab,
    projectsOpen,
    view,
    panels,
    turns,
    candidate,
    turnBusy,
    activeStep,
    canTurn,
    startTurn,
    cancelTurn,
    adoptCandidate,
    discardCandidate,
    explainSelection,
    assetDraft,
    assetKind,
    assetSize,
    assetCut,
    assetOpen,
    soundOpen,
    soundKind,
    soundRecipe,
    soundLibraryVersion,
    saveSound,
    keepSound,
    forgetKeptSound,
    pixelNewOpen,
    libraryOpen,
    recipesOpen,
    challengeOpen,
    newRecipe,
    offerLessonCandidate,
    proposeCatalogAsset,
    pixelSession,
    startPixelNew,
    editPixelFile,
    editDraftPixels,
    closePixelEditor,
    savePixelImage,
    saveAnimExample,
    mapNewOpen,
    mapSession,
    startMapNew,
    editMapFile,
    closeMapEditor,
    saveMap,
    saveMapExample,
    aiBusy,
    notice,
    bottomTab,
    updateText,
    remember,
    replaceProject,
    commit,
    run,
    stop,
    abortTurn,
    noteConsole,
    settleRun,
    undoStack,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
