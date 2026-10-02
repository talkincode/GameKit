import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
  foldStep,
  runAgentTurn,
  type AgentEvent,
  type AgentStep,
  type AgentTurnInput,
  type AgentTurnOutcome,
  type CandidateResult,
  type RunOutcome,
} from "../lib/agent";
import { assetPrompt, explainMessages, readSay, type ChatMessage } from "../lib/ai";
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
  normalizePath,
  removeFile,
  renameFile,
  slugName,
  uniquePath,
  upsertFile,
  type Project,
  type ProjectFile,
} from "../lib/project";
import { downloadBytes, ensurePlayerServiceWorker, publishPlay } from "../lib/session";
import { createBlankProject, createStarterProject } from "../lib/starter";
import { deleteStoredProject, loadProjects, saveProject } from "../lib/storage";
import { text } from "../ui/text";

export type RunState = "idle" | "starting" | "running" | "stopped" | "error";
export type SaveState = "saved" | "saving" | "error";
export type MenuId = "project" | "export" | null;
/** 做游戏 is the product; 看代码 is where the implementation lives. */
export type ViewId = "design" | "code";
/** Whose build the stage is showing. */
export type StageOwner = "current" | "candidate";

export type AssetKind = "sprite" | "background" | "tile" | "icon";

export type AssetDraft = {
  bytes: Uint8Array;
  mediaType: string;
  suggested: string;
};

/**
 * One round in the conversation pane. It is a record of what happened, not a
 * source of truth: only 采用 writes into the project.
 */
export type Turn = {
  id: string;
  kind: "design" | "explain";
  /** What the child asked, in their own words. */
  request: string;
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

/** What 撤销 restores: the files and the design card together. */
type Snapshot = { files: ProjectFile[]; design?: DesignCard };

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
  view: ViewId;
  setView: (view: ViewId) => void;
  turns: Turn[];
  candidate: CandidateResult | null;
  turnBusy: boolean;
  canTurn: boolean;
  startTurn: (request: string) => Promise<void>;
  cancelTurn: () => void;
  adoptCandidate: () => void;
  discardCandidate: () => void;
  explainSelection: () => Promise<void>;
  assetDraft: AssetDraft | null;
  assetKind: AssetKind;
  setAssetKind: (kind: AssetKind) => void;
  assetOpen: boolean;
  setAssetOpen: (open: boolean) => void;
  aiBusy: boolean;
  notice: string;
  dismissNotice: () => void;
  bottomTab: "console" | "problems" | "debug";
  setBottomTab: (tab: "console" | "problems" | "debug") => void;
  updateText: (path: string, text: string) => void;
  createFile: (path: string) => void;
  removeCurrent: () => void;
  renameCurrent: (next: string) => void;
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
  const [stageOwner, setStageOwner] = useState<StageOwner>("current");
  const [consoleText, setConsoleText] = useState("");
  const [statusNote, setStatusNote] = useState(text.stage.idle);
  const [fps, setFps] = useState<number | null>(null);
  const [frameMs, setFrameMs] = useState<number | null>(null);
  const [inputs, setInputs] = useState<string[]>([]);
  const [selection, setSelection] = useState("");
  const [menu, setMenu] = useState<MenuId>(null);
  const [view, setView] = useState<ViewId>("design");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [turnBusy, setTurnBusy] = useState(false);
  const [assetDraft, setAssetDraft] = useState<AssetDraft | null>(null);
  const [assetKind, setAssetKind] = useState<AssetKind>("sprite");
  const [assetOpen, setAssetOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [bottomTab, setBottomTab] = useState<"console" | "problems" | "debug">("console");
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [runtimeProblems, setRuntimeProblems] = useState<Problem[]>([]);
  const [account, setAccount] = useState<Account>({ kind: "checking" });
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
  const consoleRef = useRef("");

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
  const callAi = useCallback(async <T,>(body: unknown, quiet = false): Promise<T | null> => {
    const outcome: ApiOutcome<T> = await callApi<T>("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (outcome.ok) return outcome.value;
    if (outcome.problem === "sign-in" || outcome.problem === "denied") {
      const note = outcome.problem === "denied" ? "denied" : "expired";
      setSignInHint(false);
      setAccount({ kind: "anonymous", note });
      setNotice(text.account.notes[note]);
    } else if (outcome.problem === "offline") {
      setNotice(text.account.offline);
    } else if (outcome.problem === "unavailable") {
      setNotice(text.account.unavailable);
    } else if (!quiet) {
      console.warn("AI request failed:", outcome.message);
      setNotice(text.ai.failed);
    }
    return null;
  }, []);

  useEffect(() => {
    if (!ready || !project) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void saveProject(project)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [project, ready]);

  const replaceProject = useCallback((next: Project) => {
    setProjects((current) => current.map((item) => (item.id === next.id ? next : item)));
  }, []);

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

  const remember = useCallback(() => {
    if (!project) return;
    setUndoStack((stack) => [...stack, { files: project.files, design: project.design }].slice(-20));
  }, [project]);

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
    setFrameSrc("about:blank");
    setRunState((state) => (state === "idle" ? state : "stopped"));
    setStatusNote(text.stage.stopped);
    // Stopping mid-check means we have no evidence; never a code problem.
    settleRun({ kind: "quiet" });
  }, [settleRun]);

  /** Publishes a build to the stage. Throws when the preview cannot start. */
  const runProject = useCallback(async (target: Project, owner: StageOwner) => {
    if (!target.files.some((file) => file.path === "main.py" && file.text?.trim())) {
      throw new Error(text.stage.needMain);
    }
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
    setStageOwner(owner);
    await ensurePlayerServiceWorker();
    const bundle = buildWebBundle(target, { template, preview: true });
    const session = crypto.randomUUID();
    const href = await publishPlay(session, bundle);
    setFrameSrc(`${href}?run=${session}`);
    setStatusNote(text.stage.loading);
  }, []);

  const run = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    try {
      await runProject(current, "current");
    } catch (error) {
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
        void runProject(candidate, "candidate").catch((error: unknown) => {
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
      const next = (consoleRef.current + chunk).slice(-20_000);
      consoleRef.current = next;
      setConsoleText(next);
      const found = problemsFromConsole(next);
      if (found.length) {
        setRuntimeProblems(found);
        setRunState("error");
        setBottomTab("problems");
        settleRun({ kind: "error", detail: tracebackTail(next) });
      }
    },
    [settleRun],
  );

  const callModel = useCallback(
    async (messages: ChatMessage[]): Promise<string> => {
      const payload = await callAi<{ text?: string }>({ op: "complete", messages }, true);
      if (!payload || typeof payload.text !== "string" || !payload.text.trim()) {
        throw new Error("The model did not answer.");
      }
      return payload.text;
    },
    [callAi],
  );

  const startTurn = useCallback(
    async (request: string) => {
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
      let outcome: AgentTurnOutcome;
      try {
        outcome = await runAgentTurn({ id: turnId, request: fresh.request }, base, {
          model: callModel,
          diagnose: diagnoseProject,
          run: runCandidate,
          cancelled: () =>
            turnRef.current?.id !== turnId || turnRef.current.cancelled || projectRef.current?.id !== base.id,
          emit: (event) => patch((item) => applyEvent(item, event)),
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
  const candidate = activeTurn && !activeTurn.adopted && !activeTurn.discarded ? activeTurn.candidate ?? null : null;
  const canTurn = account.kind === "signed-in" && !!project && !turnBusy;

  const adoptCandidate = useCallback(() => {
    const turn = turns.at(-1);
    const target = projectRef.current;
    if (!turn?.candidate || !target || turn.candidate.project.id !== target.id) return;
    if (turn.adopted || turn.discarded) return;
    if (turn.outcome?.kind !== "ready") return;
    remember();
    replaceProject({
      ...target,
      files: turn.candidate.project.files,
      design: turn.candidate.design,
      updatedAt: Date.now(),
    });
    setTurns((list) => list.map((item) => (item.id === turn.id ? { ...item, adopted: true } : item)));
    setStageOwner("current");
  }, [remember, replaceProject, turns]);

  const discardCandidate = useCallback(() => {
    const turn = turns.at(-1);
    if (!turn?.candidate) return;
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
      view,
      setView,
      turns,
      candidate,
      turnBusy,
      canTurn,
      startTurn,
      cancelTurn,
      adoptCandidate,
      discardCandidate,
      explainSelection,
      assetDraft,
      assetKind,
      setAssetKind,
      assetOpen,
      setAssetOpen,
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
          return;
        }
        if (project.files.some((file) => file.path === next)) {
          setPath(next);
          return;
        }
        replaceProject(upsertFile(project, { path: next, text: "" }));
        setPath(next);
      },
      removeCurrent: () => {
        if (!project) return;
        remember();
        const next = removeFile(project, path);
        replaceProject(next);
        setPath(next.files[0]?.path ?? "main.py");
      },
      renameCurrent: (raw) => {
        if (!project) return;
        const next = renameFile(project, path, raw);
        if (!next) {
          setNotice(text.code.badPath);
          return;
        }
        replaceProject(next);
        setPath(normalizePath(raw) ?? path);
      },
      addBytes: (raw, bytes) => {
        if (!project) return;
        const next = normalizePath(raw);
        if (!next) {
          setNotice(text.code.badPath);
          return;
        }
        const chosen = uniquePath(
          project.files.map((file) => file.path),
          next,
        );
        replaceProject(upsertFile(project, { path: chosen, bytes }));
        setPath(chosen);
      },
      importArchive: async (file) => {
        const archive = new Uint8Array(await file.arrayBuffer());
        const imported = projectFromArchive(file.name, archive);
        await saveProject(imported);
        abortTurn();
        setProjects((current) => [imported, ...current]);
        setActiveId(imported.id);
        setTurns([]);
        localStorage.setItem(ACTIVE_KEY, imported.id);
        setPath(imported.files.some((item) => item.path === "main.py") ? "main.py" : imported.files[0].path);
        setNotice("");
        stop();
      },
      newSample: async () => {
        const created = await createStarterProject(`sample-${projects.length + 1}`);
        await saveProject(created);
        abortTurn();
        setProjects((current) => [created, ...current]);
        setActiveId(created.id);
        setTurns([]);
        localStorage.setItem(ACTIVE_KEY, created.id);
        setPath("main.py");
        stop();
      },
      newBlank: (name) => {
        const created = createBlankProject(name.trim() || "untitled");
        void saveProject(created);
        abortTurn();
        setProjects((current) => [created, ...current]);
        setActiveId(created.id);
        setTurns([]);
        localStorage.setItem(ACTIVE_KEY, created.id);
        setPath("main.py");
        stop();
      },
      openProject: (id) => {
        abortTurn();
        setActiveId(id);
        setTurns([]);
        localStorage.setItem(ACTIVE_KEY, id);
        setPath("main.py");
        setMenu(null);
        stop();
      },
      renameProject: (name) => {
        if (!project) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        replaceProject({ ...project, name: trimmed, updatedAt: Date.now() });
      },
      deleteProject: async () => {
        if (!project) return;
        await deleteStoredProject(project.id);
        const rest = projects.filter((item) => item.id !== project.id);
        abortTurn();
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
        setPath("main.py");
        stop();
      },
      duplicateProject: async () => {
        if (!project) return;
        abortTurn();
        const copy: Project = {
          ...project,
          id: crypto.randomUUID(),
          name: `${project.name} copy`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          files: project.files.map((file) => ({ ...file, bytes: file.bytes ? file.bytes.slice() : undefined })),
        };
        await saveProject(copy);
        setProjects((current) => [copy, ...current]);
        setTurns([]);
        setActiveId(copy.id);
        localStorage.setItem(ACTIVE_KEY, copy.id);
      },
      exportSource: () => {
        if (!project) return;
        downloadBytes(`${slugName(project.name)}-source.zip`, sourceZip(project), "application/zip");
      },
      exportKind: (kind) => {
        const current = requireProject();
        const bundle = buildWebBundle(current, { template, preview: false });
        const slug = slugName(current.name);
        if (kind === "web") downloadBytes(`${slug}-web.zip`, webZip(bundle), "application/zip");
        if (kind === "static") downloadBytes(`${slug}-folder.zip`, staticFolderZip(bundle, current.name), "application/zip");
        if (kind === "itch") downloadBytes(`${slug}-itch.zip`, itchZip(bundle), "application/zip");
        if (kind === "embed") downloadBytes(`${slug}-embed.zip`, embedZip(bundle), "application/zip");
        setMenu(null);
      },
      run,
      stop,
      noteStatus: setStatusNote,
      noteConsole,
      noteReady: () => {
        setRunState("running");
        setStatusNote(text.stage.running);
        settleRun({ kind: "running" });
      },
      noteTick: (nextFps, nextFrame) => {
        setFps(nextFps);
        setFrameMs(nextFrame);
        setRunState((state) => (state === "error" ? state : "running"));
        // A frame is proof the game is up, even if the first frame message was late.
        settleRun({ kind: "running" });
      },
      noteInput: (detail) => setInputs((current) => [detail, ...current].slice(0, 12)),
      undo: () => {
        const previous = undoStack.at(-1);
        if (!project || !previous) return;
        replaceProject({ ...project, files: previous.files, design: previous.design, updatedAt: Date.now() });
        setUndoStack((stack) => stack.slice(0, -1));
      },
      canUndo: undoStack.length > 0,
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
            prompt: assetPrompt(assetKind, promptText, variation.current),
          });
          if (!payload) return;
          if (!payload.image) throw new Error("Image generation failed.");
          const stamp = new Date().toISOString().slice(11, 19).replaceAll(":", "");
          setAssetDraft({
            bytes: base64ToBytes(payload.image),
            mediaType: payload.mediaType || "image/jpeg",
            suggested: `assets/${assetKind}-${stamp}.jpg`,
          });
        } catch (error) {
          setNotice(error instanceof Error ? error.message : text.ai.failed);
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
        replaceProject(upsertFile(project, { path: chosen, bytes: assetDraft.bytes }));
        setPath(chosen);
        setAssetDraft(null);
        setAssetOpen(false);
      },
      clearAsset: () => setAssetDraft(null),
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
    stageOwner,
    consoleText,
    statusNote,
    fps,
    frameMs,
    inputs,
    problems,
    selection,
    menu,
    view,
    turns,
    candidate,
    turnBusy,
    canTurn,
    startTurn,
    cancelTurn,
    adoptCandidate,
    discardCandidate,
    explainSelection,
    assetDraft,
    assetKind,
    assetOpen,
    aiBusy,
    notice,
    bottomTab,
    updateText,
    remember,
    replaceProject,
    run,
    stop,
    abortTurn,
    noteConsole,
    settleRun,
    undoStack,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
