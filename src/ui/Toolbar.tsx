import { useEffect, useRef } from "react";
import { slugName } from "../lib/project";
import { useStudio } from "../studio/store";
import { AgentWorking } from "./AgentWorking";
import { BrandMark } from "./BrandMark";
import { text } from "./text";

/**
 * The header. Two views: 做游戏 (the designer) and 看代码 (the implementation).
 * Project and export actions live here so the designer stays about the game.
 */
export function Toolbar() {
  const studio = useStudio();
  const root = useRef<HTMLElement>(null);
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
        <BrandMark />
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

      {studio.collabActive ? (
        <button
          type="button"
          className="collab-badge"
          data-testid="collab-badge"
          title={text.collab.badgeTitle}
          onClick={() => studio.setSettingsOpen(true)}
        >
          <span className="collab-dot" />
          <span>{text.collab.badge}</span>
        </button>
      ) : null}

      <div className="cluster">
        {studio.view === "code" ? (
          <div className="panel-toggles" role="group" aria-label={text.header.panels}>
            {(
              [
                ["side", text.header.panelFiles],
                ["stage", text.header.panelStage],
                ["bottom", text.header.panelConsole],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={studio.panels[id]}
                data-testid={`panel-${id}`}
                className={studio.panels[id] ? "on" : ""}
                onClick={() => studio.togglePanel(id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <button
          className="ghost"
          type="button"
          title={text.header.undo}
          disabled={!studio.canUndo}
          onClick={studio.undo}
        >
          <IconUndo />
          {text.header.undoShort}
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            studio.setMenu(null);
            studio.setProjectsOpen(true);
          }}
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
      </div>

      <div className={`save save-${studio.saveState}`} title={text.header.saveHint}>
        {text.header.save[studio.saveState]}
      </div>

      <button
        className="ghost icon-only"
        type="button"
        title={text.settings.title}
        aria-label={text.settings.title}
        data-testid="settings-open"
        onClick={() => studio.setSettingsOpen(true)}
      >
        <IconGear />
      </button>

      <Account />

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

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="gear-icon">
      <path d="M8 5.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z" />
      <path d="M8 1.8l.9 1.5 1.7-.4.4 1.7 1.5.9-1 1.4 1 1.4-1.5.9-.4 1.7-1.7-.4L8 14.2l-.9-1.5-1.7.4-.4-1.7-1.5-.9 1-1.4-1-1.4 1.5-.9.4-1.7 1.7.4Z" />
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

function Account() {  const studio = useStudio();
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

