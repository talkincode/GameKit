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
import { assetPrompt, messagesFor, readModelResult, type FileProposal } from "../lib/ai";
import { buildWebBundle } from "../lib/build";
import { diagnoseProject, problemsFromConsole, type Problem } from "../lib/diagnostics";
import { diffLines, type DiffRow } from "../lib/diff";
import {
  embedZip,
  itchZip,
  projectFromArchive,
  sourceZip,
  staticFolderZip,
  webZip,
} from "../lib/export";
import { base64ToBytes } from "../lib/project";
import {
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

export type RunState = "idle" | "starting" | "running" | "stopped" | "error";
export type SaveState = "saved" | "saving" | "error";
export type MenuId = "project" | "ai" | "export" | null;
export type AiAction = "initialize" | "generate" | "complete" | "refactor" | "explain" | "fix";

export type Proposal = {
  title: string;
  explanation: string;
  files: { path: string; before: string; after: string; rows: DiffRow[] }[];
};

export type AssetKind = "sprite" | "background" | "tile" | "icon";

export type AssetDraft = {
  bytes: Uint8Array;
  mediaType: string;
  suggested: string;
};

type StudioValue = {
  ready: boolean;
  project: Project | null;
  projects: Project[];
  path: string;
  setPath: (path: string) => void;
  saveState: SaveState;
  runState: RunState;
  frameSrc: string;
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
  proposal: Proposal | null;
  assetDraft: AssetDraft | null;
  assetKind: AssetKind;
  setAssetKind: (kind: AssetKind) => void;
  composer: "initialize" | "generate" | "asset" | null;
  setComposer: (composer: "initialize" | "generate" | "asset" | null) => void;
  aiBusy: boolean;
  notice: string;
  dismissNotice: () => void;
  side: number;
  bottom: number;
  setSide: (value: number) => void;
  setBottom: (value: number) => void;
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
  ask: (action: AiAction, prompt?: string) => Promise<void>;
  acceptProposal: () => void;
  rejectProposal: () => void;
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

export function StudioProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState("");
  const [path, setPath] = useState("main.py");
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [runState, setRunState] = useState<RunState>("idle");
  const [frameSrc, setFrameSrc] = useState("about:blank");
  const [consoleText, setConsoleText] = useState("");
  const [statusNote, setStatusNote] = useState("Idle");
  const [fps, setFps] = useState<number | null>(null);
  const [frameMs, setFrameMs] = useState<number | null>(null);
  const [inputs, setInputs] = useState<string[]>([]);
  const [selection, setSelection] = useState("");
  const [menu, setMenu] = useState<MenuId>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [assetDraft, setAssetDraft] = useState<AssetDraft | null>(null);
  const [assetKind, setAssetKind] = useState<AssetKind>("sprite");
  const [composer, setComposer] = useState<"initialize" | "generate" | "asset" | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [side, setSide] = useState(248);
  const [bottom, setBottom] = useState(176);
  const [bottomTab, setBottomTab] = useState<"console" | "problems" | "debug">("console");
  const [undoStack, setUndoStack] = useState<ProjectFile[][]>([]);
  const [runtimeProblems, setRuntimeProblems] = useState<Problem[]>([]);
  const variation = useRef(1);
  const project = projects.find((item) => item.id === activeId) ?? null;
  const projectRef = useRef(project);
  projectRef.current = project;

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
      setNotice(error instanceof Error ? error.message : "Could not open local projects.");
      setReady(true);
    });
    return () => {
      cancel = true;
    };
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
    setUndoStack((stack) => [...stack, project.files].slice(-20));
  }, [project]);

  const stop = useCallback(() => {
    setFrameSrc("about:blank");
    setRunState((state) => (state === "idle" ? state : "stopped"));
    setStatusNote("Stopped");
  }, []);

  const run = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    if (!current.files.some((file) => file.path === "main.py" && file.text?.trim())) {
      setBottomTab("problems");
      setNotice("Add main.py before running.");
      return;
    }
    setMenu(null);
    setRunState("starting");
    setConsoleText("");
    setRuntimeProblems([]);
    setFps(null);
    setFrameMs(null);
    setInputs([]);
    setStatusNote("Preparing the pygame runtime…");
    setFrameSrc("about:blank");
    try {
      await ensurePlayerServiceWorker();
      const bundle = buildWebBundle(current, { template, preview: true });
      const session = crypto.randomUUID();
      const href = await publishPlay(session, bundle);
      setFrameSrc(`${href}?run=${session}`);
      setStatusNote("Loading pygame-ce…");
    } catch (error) {
      setRunState("error");
      setStatusNote("Could not start");
      setNotice(error instanceof Error ? error.message : "Run failed.");
      setBottomTab("console");
    }
  }, []);

  const noteConsole = useCallback((text: string) => {
    setConsoleText((current) => {
      const next = (current + text).slice(-20_000);
      const found = problemsFromConsole(next);
      if (found.length) {
        setRuntimeProblems(found);
        setRunState("error");
        setBottomTab("problems");
      }
      return next;
    });
  }, []);

  const value = useMemo<StudioValue>(() => {
    const requireProject = () => {
      if (!project) throw new Error("No project is open.");
      return project;
    };
    return {
      ready,
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
      proposal,
      assetDraft,
      assetKind,
      setAssetKind,
      composer,
      setComposer,
      aiBusy,
      notice,
      dismissNotice: () => setNotice(""),
      side,
      bottom,
      setSide,
      setBottom,
      bottomTab,
      setBottomTab,
      updateText,
      createFile: (raw) => {
        const next = normalizePath(raw);
        if (!project || !next) {
          setNotice("Use a relative path such as game/enemy.py.");
          return;
        }
        if (project.files.some((file) => file.path === next)) {
          setPath(next);
          return;
        }
        replaceProject(upsertFile(project, { path: next, text: next.endsWith(".py") ? "" : "" }));
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
          setNotice("That path is empty, unsafe, or already used.");
          return;
        }
        replaceProject(next);
        setPath(normalizePath(raw) ?? path);
      },
      addBytes: (raw, bytes) => {
        if (!project) return;
        const next = normalizePath(raw);
        if (!next) {
          setNotice("That asset path is not valid.");
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
        setProjects((current) => [imported, ...current]);
        setActiveId(imported.id);
        localStorage.setItem(ACTIVE_KEY, imported.id);
        setPath(imported.files.some((item) => item.path === "main.py") ? "main.py" : imported.files[0].path);
        setNotice("");
        stop();
      },
      newSample: async () => {
        const created = await createStarterProject(`sample-${projects.length + 1}`);
        await saveProject(created);
        setProjects((current) => [created, ...current]);
        setActiveId(created.id);
        localStorage.setItem(ACTIVE_KEY, created.id);
        setPath("main.py");
        stop();
      },
      newBlank: (name) => {
        const created = createBlankProject(name.trim() || "untitled");
        void saveProject(created);
        setProjects((current) => [created, ...current]);
        setActiveId(created.id);
        localStorage.setItem(ACTIVE_KEY, created.id);
        setPath("main.py");
        stop();
      },
      openProject: (id) => {
        setActiveId(id);
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
        setPath("main.py");
        stop();
      },
      duplicateProject: async () => {
        if (!project) return;
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
        setStatusNote("Running");
      },
      noteTick: (nextFps, nextFrame) => {
        setFps(nextFps);
        setFrameMs(nextFrame);
        setRunState((state) => (state === "error" ? state : "running"));
      },
      noteInput: (detail) => setInputs((current) => [detail, ...current].slice(0, 12)),
      ask: async (action, promptText) => {
        const current = requireProject();
        const file = current.files.find((item) => item.path === path);
        if ((action === "complete" || action === "refactor") && !selection.trim()) {
          setNotice("Select the code you want to change.");
          return;
        }
        setAiBusy(true);
        setNotice("");
        setComposer(null);
        try {
          const messages = messagesFor(action, {
            prompt: promptText ?? "",
            path,
            source: file?.text ?? "",
            selection,
            error: problems.find((item) => item.severity === "error")?.message,
          });
          const response = await fetch("/api/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ op: "complete", messages }),
          });
          const payload = (await response.json()) as { text?: string; error?: string };
          if (!response.ok || !payload.text) throw new Error(payload.error || "AI request failed.");
          const result = readModelResult(payload.text, current, path);
          if (result.kind === "explain") {
            setProposal({ title: "Explain", explanation: result.explanation, files: [] });
            return;
          }
          setProposal(toProposal(titleFor(action), result, current));
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "AI request failed.");
        } finally {
          setAiBusy(false);
        }
      },
      acceptProposal: () => {
        if (!project || !proposal) return;
        remember();
        let next = project;
        for (const file of proposal.files) next = upsertFile(next, { path: file.path, text: file.after });
        replaceProject(next);
        if (proposal.files[0]) setPath(proposal.files[0].path);
        setProposal(null);
      },
      rejectProposal: () => setProposal(null),
      undo: () => {
        const previous = undoStack.at(-1);
        if (!project || !previous) return;
        replaceProject({ ...project, files: previous, updatedAt: Date.now() });
        setUndoStack((stack) => stack.slice(0, -1));
      },
      canUndo: undoStack.length > 0,
      generateAsset: async (promptText) => {
        variation.current += 1;
        setAiBusy(true);
        setNotice("");
        try {
          const response = await fetch("/api/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ op: "image", prompt: assetPrompt(assetKind, promptText, variation.current) }),
          });
          const payload = (await response.json()) as { image?: string; mediaType?: string; error?: string };
          if (!response.ok || !payload.image) throw new Error(payload.error || "Image generation failed.");
          const stamp = new Date().toISOString().slice(11, 19).replaceAll(":", "");
          setAssetDraft({
            bytes: base64ToBytes(payload.image),
            mediaType: payload.mediaType || "image/jpeg",
            suggested: `assets/${assetKind}-${stamp}.jpg`,
          });
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Image generation failed.");
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
        setComposer(null);
      },
      clearAsset: () => setAssetDraft(null),
    };
  }, [
    ready,
    project,
    projects,
    path,
    saveState,
    runState,
    frameSrc,
    consoleText,
    statusNote,
    fps,
    frameMs,
    inputs,
    problems,
    selection,
    menu,
    proposal,
    assetDraft,
    assetKind,
    composer,
    aiBusy,
    notice,
    side,
    bottom,
    bottomTab,
    updateText,
    remember,
    replaceProject,
    run,
    stop,
    noteConsole,
    undoStack,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

function titleFor(action: AiAction): string {
  if (action === "initialize") return "Initialize project";
  if (action === "generate") return "Generate code";
  if (action === "complete") return "Complete selection";
  if (action === "refactor") return "Refactor selection";
  if (action === "explain") return "Explain";
  return "Fix error";
}

function toProposal(title: string, result: FileProposal, project: Project): Proposal {
  return {
    title,
    explanation: result.explanation,
    files: result.files.map((file) => {
      const before = project.files.find((item) => item.path === file.path)?.text ?? "";
      return { path: file.path, before, after: file.content, rows: diffLines(before, file.content) };
    }),
  };
}
