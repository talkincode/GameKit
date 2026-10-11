import { useEffect, useRef, useState } from "react";
import { slugName } from "../lib/project";
import { useStudio } from "../studio/store";
import { AgentWorking } from "./AgentWorking";
import { BrandMark } from "./BrandMark";
import { text } from "./text";

/**
 * Studio header, one row.
 *
 * Left: mark, project name (opens the project menu), save state.
 * Center: 做游戏 / 看代码, the main control.
 * Right: undo, 素材库, 导出 (the only primary button), 更多, account.
 *
 * Below 1100px 素材库 moves into 更多; below 800px undo does too.
 * 文件栏 / 舞台 / 控制台 live on the code editor's tab bar, not here.
 */
type NavTier = "wide" | "medium" | "narrow";

function tierOf(width: number): NavTier {
  if (width >= 1100) return "wide";
  if (width >= 800) return "medium";
  return "narrow";
}

function useNavTier(): NavTier {
  const [tier, setTier] = useState<NavTier>(() => tierOf(window.innerWidth));
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1100px)");
    const medium = window.matchMedia("(min-width: 800px)");
    const update = () => setTier(wide.matches ? "wide" : medium.matches ? "medium" : "narrow");
    update();
    wide.addEventListener("change", update);
    medium.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      medium.removeEventListener("change", update);
    };
  }, []);
  return tier;
}

export function Toolbar() {
  const studio = useStudio();
  const tier = useNavTier();
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) studio.setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") studio.setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [studio]);

  const showLibrary = tier === "wide";
  const showUndo = tier !== "narrow";

  return (
    <header className="toolbar" data-testid="toolbar" data-tier={tier} ref={root}>
      <div className="toolbar-side toolbar-left">
        <div className="brand">
          <BrandMark />
          <div className="brand-copy">
            <strong className="brand-word">{text.brand.name}</strong>
            <span className="brand-tagline">{text.brand.tagline}</span>
          </div>
        </div>
        <ProjectSlot />
      </div>

      <div className="view-switch" role="tablist" aria-label={text.brand.name}>
        <button
          type="button"
          role="tab"
          aria-selected={studio.view === "design"}
          className={studio.view === "design" ? "on" : ""}
          onClick={() => studio.setView("design")}
        >
          {text.header.design}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={studio.view === "code"}
          className={studio.view === "code" ? "on" : ""}
          onClick={() => studio.setView("code")}
        >
          {text.header.code}
        </button>
      </div>

      <div className="toolbar-side toolbar-right">
        <AgentWorking where="header" />
        {studio.collabActive ? (
          <button
            type="button"
            className="collab-badge"
            data-testid="collab-badge"
            title={text.collab.badgeTitle}
            onClick={() => studio.setSettingsOpen(true)}
          >
            <span className="collab-dot" />
            <span className="collab-label">{text.collab.badge}</span>
          </button>
        ) : null}
        {showUndo ? <UndoButton place="bar" /> : null}
        {showLibrary ? <LibraryButton place="bar" /> : null}
        <ExportButton />
        <MoreMenu showUndo={!showUndo} showLibrary={!showLibrary} />
        <Account />
      </div>
    </header>
  );
}

function ProjectSlot() {
  const studio = useStudio();
  const name = studio.project?.name || text.header.untitled;
  const open = studio.menu === "project";
  return (
    <div className="project-slot">
      <div className="menu-anchor">
        <button
          type="button"
          className="project-name-btn"
          data-testid="project-menu"
          title={name}
          aria-label={text.header.projectMenu(name)}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => studio.setMenu(open ? null : "project")}
        >
          <span className="project-title">{name}</span>
          <IconCaret />
        </button>
        {open ? (
          <div className="menu" data-testid="project-menu-panel" role="group" aria-label={text.header.project}>
            <button type="button" onClick={() => newProject(studio)}>
              {text.header.newProject}
            </button>
            <button type="button" data-testid="projects-open" onClick={() => openProjects(studio)}>
              {text.header.switchProject}
              <small>{text.header.switchProjectHint}</small>
            </button>
            <button type="button" data-testid="recipes-open" onClick={() => openRecipes(studio)}>
              {text.header.fromRecipe}
              <small>{text.header.fromRecipeHint}</small>
            </button>
            <label className="file-btn" data-testid="project-import">
              {text.project.importZip}
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  studio.setMenu(null);
                  void studio.importArchive(file);
                }}
              />
            </label>
          </div>
        ) : null}
      </div>
      <span className={`save save-${studio.saveState}`} data-testid="save-state" title={text.header.saveHint}>
        {text.header.save[studio.saveState]}
      </span>
    </div>
  );
}

function newProject(studio: ReturnType<typeof useStudio>) {
  studio.setMenu(null);
  const name = window.prompt(text.project.namePrompt, "my-game");
  if (name) studio.newBlank(name);
}

function openProjects(studio: ReturnType<typeof useStudio>) {
  studio.setMenu(null);
  studio.setProjectsOpen(true);
}

function openRecipes(studio: ReturnType<typeof useStudio>) {
  studio.setMenu(null);
  studio.setRecipesOpen(true);
}

function UndoButton({ place }: { place: "bar" | "menu" }) {
  const studio = useStudio();
  return (
    <button
      type="button"
      className={place === "bar" ? "icon-btn" : "menu-row"}
      data-testid="undo"
      title={text.header.undo}
      aria-label={text.header.undo}
      disabled={!studio.canUndo}
      onClick={studio.undo}
    >
      <IconUndo />
      {place === "menu" ? text.header.undoShort : null}
    </button>
  );
}

function LibraryButton({ place }: { place: "bar" | "menu" }) {
  const studio = useStudio();
  return (
    <button
      type="button"
      className={place === "bar" ? "ghost" : undefined}
      data-testid="library-open"
      title={text.library.open}
      onClick={() => {
        studio.setMenu(null);
        studio.setLibraryOpen(true);
      }}
    >
      {text.library.open}
    </button>
  );
}

function ExportButton() {
  const studio = useStudio();
  const open = studio.menu === "export";
  return (
    <div className="menu-anchor align-end">
      <button
        className="run toolbar-primary"
        type="button"
        data-testid="export-open"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => studio.setMenu(open ? null : "export")}
      >
        {text.header.export}
      </button>
      {open ? (
        <div className="menu menu-export" data-testid="export-menu" role="group" aria-label={text.header.export}>
          <p data-testid="export-offline-note">{text.export.copy}</p>
          <button type="button" onClick={() => studio.exportKind("web")}>
            {text.export.web}
            <small>{text.export.webHint}</small>
          </button>
          <button type="button" onClick={() => studio.exportKind("static")}>
            {text.export.static}
            <small>{text.export.staticHint}</small>
          </button>
          <button type="button" onClick={() => studio.exportKind("itch")}>
            {text.export.itch}
            <small>{text.export.itchHint}</small>
          </button>
          <button type="button" onClick={() => studio.exportKind("embed")}>
            {text.export.embed}
            <small>{text.export.embedHint}</small>
          </button>
          {studio.project ? <small className="menu-foot">{slugName(studio.project.name)}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

function MoreMenu({ showUndo, showLibrary }: { showUndo: boolean; showLibrary: boolean }) {
  const studio = useStudio();
  const open = studio.menu === "more";
  return (
    <div className="menu-anchor align-end">
      <button
        type="button"
        className="icon-btn"
        data-testid="more-open"
        title={text.header.more}
        aria-label={text.header.more}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => studio.setMenu(open ? null : "more")}
      >
        <IconMore />
      </button>
      {open ? (
        <div className="menu" data-testid="more-menu-panel" role="group" aria-label={text.header.moreLabel}>
          {showUndo ? <UndoButton place="menu" /> : null}
          {showLibrary ? <LibraryButton place="menu" /> : null}
          <button
            type="button"
            data-testid="logs-open"
            onClick={() => {
              studio.setMenu(null);
              studio.setLogsOpen(true);
            }}
          >
            {text.logs.open}
          </button>
          <button
            type="button"
            className="menu-row"
            data-testid="settings-open"
            onClick={() => {
              studio.setMenu(null);
              studio.setSettingsOpen(true);
            }}
          >
            <IconGear />
            {text.settings.title}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Account() {
  const studio = useStudio();
  const account = studio.account;
  if (account.kind === "checking") {
    return (
      <div className="account account-checking" role="status">
        {text.account.checking}
      </div>
    );
  }
  if (account.kind === "anonymous") {
    return (
      <div className="account">
        <button className="ghost" type="button" onClick={studio.signIn}>
          {text.account.signIn}
        </button>
      </div>
    );
  }
  const email = account.kind === "signed-in" ? account.email : "";
  const name = email ? email.split("@")[0] : "";
  const initial = (name || "?").charAt(0).toUpperCase();
  const title =
    account.kind === "unreachable"
      ? account.reason === "offline"
        ? text.account.offline
        : text.account.unavailable
      : email;
  const open = studio.menu === "account";
  return (
    <div className="account menu-anchor align-end">
      <button
        type="button"
        className="account-btn"
        data-testid="account-menu"
        title={title}
        aria-label={name ? text.header.accountMenu(name) : text.header.accountMenuLabel}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => studio.setMenu(open ? null : "account")}
      >
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        {name ? <span className="account-name">{name}</span> : null}
      </button>
      {open ? (
        <div className="menu" data-testid="account-menu-panel" role="group" aria-label={text.header.accountMenuLabel}>
          <p>{title}</p>
          <button className="menu-row" type="button" onClick={studio.signOut}>
            {text.account.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="gear-icon">
      <path d="M8 5.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z" />
      <path d="M8 1.8l.9 1.5 1.7-.4.4 1.7 1.5.9-1 1.4 1 1.4-1.5.9-.4 1.7-1.7-.4L8 14.2l-.9-1.5-1.7.4-.4-1.7-1.5-.9 1-1.4-1-1.4 1.5-.9.4-1.7 1.7.4Z" />
    </svg>
  );
}

function IconMore() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="more-icon">
      <circle cx="3.2" cy="8" r="1.35" />
      <circle cx="8" cy="8" r="1.35" />
      <circle cx="12.8" cy="8" r="1.35" />
    </svg>
  );
}

function IconCaret() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="caret-icon">
      <path d="M4.2 6.3 8 10.1 11.8 6.3" />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="undo-icon">
      <path d="M3.2 8a4.8 4.8 0 1 0 1.6-3.6" />
      <path d="M3 2.8v2.6h2.6" />
    </svg>
  );
}
