import { useEffect, useMemo, useState } from "react";
import type { Project } from "../lib/project";
import { useStudio } from "../studio/store";
import { text } from "./text";

/**
 * 我的项目：the project switcher, as a surface of its own.
 *
 * Everything here goes through the studio's actions (no direct storage access),
 * deletes are confirmed in place, and nothing is written until the child says so.
 */
export function ProjectsPanel() {
  const studio = useStudio();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const open = studio.projectsOpen;

  useEffect(() => {
    if (!open) return;
    setConfirming(null);
    setRenaming(null);
    void navigator.storage?.estimate?.().then((estimate) => setUsed(estimate.usage ?? null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (renaming || confirming) {
          setRenaming(null);
          setConfirming(null);
        } else {
          studio.setProjectsOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, renaming, confirming, studio]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = [...studio.projects].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!needle) return list;
    return list.filter((project) => project.name.toLowerCase().includes(needle));
  }, [studio.projects, query]);

  if (!open) return null;

  return (
    <div className="modal-back" role="presentation">
      <section className="modal projects" data-testid="projects-panel" aria-label={text.project.title}>
        <header className="projects-head">
          <h2>📁 {text.project.title}</h2>
          <input
            className="projects-search"
            type="search"
            value={query}
            placeholder={text.project.search}
            aria-label={text.project.search}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="run"
            type="button"
            onClick={() => {
              const name = window.prompt(text.project.namePrompt, "my-game");
              if (name) studio.newBlank(name);
            }}
          >
            ＋ {text.project.newProject}
          </button>
          <label className="file-btn">
            📂 {text.project.importZip}
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void studio.importArchive(file);
                event.target.value = "";
              }}
            />
          </label>
          <button
            className="ghost"
            type="button"
            title={text.project.close}
            aria-label={text.project.close}
            data-testid="projects-close"
            onClick={() => studio.setProjectsOpen(false)}
          >
            ✕
          </button>
        </header>

        <div className="projects-body">
          {shown.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              current={project.id === studio.project?.id}
              renaming={renaming === project.id}
              draft={draft}
              confirming={confirming === project.id}
              onDraft={setDraft}
              onStartRename={() => {
                setConfirming(null);
                setRenaming(project.id);
                setDraft(project.name);
              }}
              onRename={() => {
                if (project.id === studio.project?.id) studio.renameProject(draft);
                setRenaming(null);
              }}
              onAskDelete={() => {
                setRenaming(null);
                setConfirming(project.id);
              }}
              onDelete={() => {
                if (project.id === studio.project?.id) void studio.deleteProject();
                setConfirming(null);
              }}
              onCancel={() => {
                setRenaming(null);
                setConfirming(null);
              }}
              onOpen={() => studio.openProject(project.id)}
              onDuplicate={() => void studio.duplicateProject()}
              onExport={() => studio.exportSource()}
            />
          ))}
          {!studio.projects.length ? <p className="projects-empty">{text.project.empty}</p> : null}
          {studio.projects.length && !shown.length ? <p className="projects-empty">{text.project.searchEmpty}</p> : null}
        </div>

        <footer className="projects-foot">
          <span>{text.project.footer(studio.projects.length, text.project.local)}</span>
          {used !== null ? <span>{text.project.used(formatBytes(used))}</span> : null}
          <span className="quiet">{text.project.switchHint}</span>
        </footer>
      </section>
    </div>
  );
}

function ProjectCard({
  project,
  current,
  renaming,
  draft,
  confirming,
  onDraft,
  onStartRename,
  onRename,
  onAskDelete,
  onDelete,
  onCancel,
  onOpen,
  onDuplicate,
  onExport,
}: {
  project: Project;
  current: boolean;
  renaming: boolean;
  draft: string;
  confirming: boolean;
  onDraft: (value: string) => void;
  onStartRename: () => void;
  onRename: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onOpen: () => void;
  onDuplicate: () => void;
  onExport: () => void;
}) {
  if (renaming) {
    return (
      <article className="project-card renaming">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) onRename();
            else onCancel();
          }}
        >
          <label>
            {text.project.renameHint}
            <input
              value={draft}
              autoFocus
              onFocus={(event) => event.target.select()}
              onChange={(event) => onDraft(event.target.value)}
            />
          </label>
          <div className="project-actions">
            <button className="run" type="submit" disabled={!draft.trim()}>
              {text.project.rename}
            </button>
            <button type="button" onClick={onCancel}>
              {text.project.cancel}
            </button>
          </div>
        </form>
      </article>
    );
  }

  return (
    <article className={current ? "project-card current" : "project-card"} data-project={project.name}>
      <button className="project-open" type="button" onClick={onOpen} title={text.project.open}>
        <span className="project-name">
          {project.name}
          {current ? <em>{text.project.current}</em> : null}
        </span>
        <span className="project-meta">
          {text.project.updated(relativeTime(project.updatedAt))} · {text.project.files(project.files.length)}
          {project.design?.title ? ` · ${project.design.title}` : ""}
        </span>
      </button>
      {confirming ? (
        <div className="project-confirm" data-testid="project-delete-confirm">
          <span>{text.project.confirmDelete(project.name)}</span>
          <div className="project-actions">
            <button type="button" className="danger" onClick={onDelete} disabled={!current}>
              {text.project.deleteConfirm}
            </button>
            <button type="button" onClick={onCancel}>
              {text.project.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="project-actions">
          <button type="button" onClick={onStartRename} disabled={!current} title={current ? text.project.rename : text.project.openFirst}>
            {text.project.rename}
          </button>
          <button type="button" onClick={onDuplicate} disabled={!current} title={current ? text.project.duplicate : text.project.openFirst}>
            {text.project.duplicate}
          </button>
          <button type="button" onClick={onExport} disabled={!current} title={current ? text.project.exportSource : text.project.openFirst}>
            {text.project.exportSource}
          </button>
          <button
            type="button"
            className="danger"
            onClick={onAskDelete}
            disabled={!current}
            title={current ? text.project.delete : text.project.openFirst}
          >
            {text.project.delete}
          </button>
        </div>
      )}
    </article>
  );
}

/** "刚刚" / "3 分钟前" / "2 天前"，够孩子看懂就行。 */
function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
