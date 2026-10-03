import { useEffect, useRef, useState } from "react";
import { slugName } from "../lib/project";
import { useStudio } from "../studio/store";
import { AgentWorking } from "./AgentWorking";
import { text } from "./text";

/**
 * The header. Two views: 做游戏 (the designer) and 看代码 (the implementation).
 * Project and export actions live here so the designer stays about the game.
 */
export function Toolbar() {
  const studio = useStudio();
  const root = useRef<HTMLElement>(null);
  const [name, setName] = useState("");

  useEffect(() => setName(studio.project?.name ?? ""), [studio.project?.name]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) studio.setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [studio]);

  return (
    <header className="toolbar" ref={root}>
      <div className="brand">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="6" />
          <path d="M12 9.5v13l10-6.5-10-6.5z" />
        </svg>
        <div>
          <strong>{text.brand.name}</strong>
          <span>{text.brand.tagline}</span>
        </div>
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

      <AgentWorking where="header" />

      <div className="cluster">
        <button
          className="ghost"
          type="button"
          onClick={() => studio.setMenu(studio.menu === "project" ? null : "project")}
        >
          {text.header.project}
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => studio.setMenu(studio.menu === "export" ? null : "export")}
        >
          {text.header.export}
        </button>
        <button className="ghost" type="button" disabled={!studio.canUndo} onClick={studio.undo}>
          {text.header.undo}
        </button>
      </div>

      <div className={`save save-${studio.saveState}`} title={text.header.saveHint}>
        {text.header.save[studio.saveState]}
      </div>

      <Account />

      {studio.menu === "project" && studio.project ? (
        <div className="menu menu-project" data-testid="project-menu">
          <label>
            {text.project.name}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => studio.renameProject(name)}
              onKeyDown={(event) => {
                if (event.key === "Enter") studio.renameProject(name);
              }}
            />
          </label>
          <p>{text.project.switchHint}</p>
          <button type="button" onClick={() => void studio.newSample()}>
            {text.project.newSample}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = window.prompt(text.project.namePrompt, "untitled");
              if (next) studio.newBlank(next);
            }}
          >
            {text.project.newBlank}
          </button>
          <button type="button" onClick={() => void studio.duplicateProject()}>
            {text.project.duplicate}
          </button>
          <button type="button" onClick={studio.exportSource}>
            {text.project.exportSource}
          </button>
          <label className="file-btn">
            {text.project.importZip}
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
          <small className="menu-foot">{text.project.open}</small>
          <div className="menu-list">
            {studio.projects.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === studio.project?.id ? "current" : ""}
                onClick={() => studio.openProject(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <button
            className="danger"
            type="button"
            onClick={() => {
              if (window.confirm(text.project.confirmDelete)) void studio.deleteProject();
            }}
          >
            {text.project.delete}
          </button>
        </div>
      ) : null}

      {studio.menu === "export" ? (
        <div className="menu menu-export">
          <p>{text.export.copy}</p>
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
    </header>
  );
}

function Account() {
  const studio = useStudio();
  const account = studio.account;
  if (account.kind === "checking") return <div className="account">{text.account.checking}</div>;
  if (account.kind === "signed-in") {
    return (
      <div className="account">
        <span title={account.email}>{account.email.split("@")[0]}</span>
        <button className="ghost" type="button" onClick={studio.signOut}>
          {text.account.signOut}
        </button>
      </div>
    );
  }
  if (account.kind === "unreachable") {
    return (
      <div className="account" title={account.reason === "offline" ? text.account.offline : text.account.unavailable}>
        <button className="ghost" type="button" onClick={studio.signOut}>
          {text.account.signOut}
        </button>
      </div>
    );
  }
  return (
    <div className="account">
      <button className="ghost" type="button" onClick={studio.signIn}>
        {text.account.signIn}
      </button>
    </div>
  );
}

