import { useEffect, useRef, useState } from "react";
import { slugName } from "../lib/project";
import { useStudio } from "../studio/store";
import { text } from "./text";

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
          <strong>GameKit</strong>
          <span>Build Pygame games in your browser</span>
        </div>
      </div>

      <div className="cluster">
        <button className="ghost" type="button" onClick={() => studio.setMenu(studio.menu === "project" ? null : "project")}>
          Project
        </button>
        <button className="run" type="button" onClick={() => void studio.run()} disabled={!studio.project || studio.runState === "starting"}>
          <i />
          {studio.runState === "starting" ? "Starting" : "Run"}
          <kbd>F5</kbd>
        </button>
        <button className="stop" type="button" onClick={studio.stop}>
          <i />
          Stop
          <kbd>F6</kbd>
        </button>
        <button className="ghost" type="button" onClick={() => studio.setBottomTab("debug")}>
          Debug
        </button>
        <button className="ghost" type="button" onClick={() => studio.setMenu(studio.menu === "ai" ? null : "ai")}>
          AI Tools
        </button>
        <button className="ghost" type="button" onClick={() => studio.setMenu(studio.menu === "export" ? null : "export")}>
          Export
        </button>
      </div>

      <div className={`save save-${studio.saveState}`}>{labelForSave(studio.saveState)}</div>

      <Account />

      {studio.menu === "project" && studio.project ? (
        <div className="menu menu-project">
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => studio.renameProject(name)}
              onKeyDown={(event) => {
                if (event.key === "Enter") studio.renameProject(name);
              }}
            />
          </label>
          <button type="button" onClick={() => void studio.newSample()}>
            New sample project
          </button>
          <button
            type="button"
            onClick={() => {
              const next = window.prompt("Project name", "untitled");
              if (next) studio.newBlank(next);
            }}
          >
            New empty project
          </button>
          <button type="button" onClick={() => void studio.duplicateProject()}>
            Duplicate
          </button>
          <button type="button" onClick={studio.exportSource}>
            Export source zip
          </button>
          <label className="file-btn">
            Import zip
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
          <div className="menu-list">
            {studio.projects.map((item) => (
              <button key={item.id} type="button" className={item.id === studio.project?.id ? "current" : ""} onClick={() => studio.openProject(item.id)}>
                {item.name}
              </button>
            ))}
          </div>
          <button className="danger" type="button" onClick={() => void studio.deleteProject()}>
            Delete project
          </button>
        </div>
      ) : null}

      {studio.menu === "ai" && studio.account.kind !== "signed-in" ? (
        <div className="menu" data-testid="ai-menu">
          <p>{text.ai.needsSignIn}</p>
          <button type="button" onClick={studio.signIn}>
            {text.ai.signInToUse}
          </button>
          <button type="button" disabled={!studio.canUndo} onClick={studio.undo}>
            Undo last accepted change
          </button>
        </div>
      ) : null}

      {studio.menu === "ai" && studio.account.kind === "signed-in" ? (
        <div className="menu" data-testid="ai-menu">
          <p>AI edits one scope at a time. You accept or reject the result.</p>
          <button type="button" onClick={() => openAi(studio, "initialize")}>
            Initialize project
          </button>
          <button type="button" onClick={() => openAi(studio, "generate")}>
            Generate code
          </button>
          <button type="button" onClick={() => void studio.ask("complete")}>
            Complete selection
          </button>
          <button type="button" onClick={() => void studio.ask("refactor")}>
            Refactor selection
          </button>
          <button type="button" onClick={() => void studio.ask("explain")}>
            Explain code
          </button>
          <button type="button" onClick={() => void studio.ask("fix")}>
            Fix error
          </button>
          <button type="button" onClick={() => studio.setComposer("asset")}>
            Generate asset
          </button>
          <button type="button" disabled={!studio.canUndo} onClick={studio.undo}>
            Undo last accepted change
          </button>
        </div>
      ) : null}

      {studio.menu === "export" ? (
        <div className="menu">
          <p>These are files. GameKit does not host the game.</p>
          <button type="button" onClick={() => studio.exportKind("web")}>
            Web ZIP
            <small>index.html and the runtime archive</small>
          </button>
          <button type="button" onClick={() => studio.exportKind("static")}>
            Static folder
            <small>Unzip and host the folder anywhere</small>
          </button>
          <button type="button" onClick={() => studio.exportKind("itch")}>
            itch.io package
            <small>HTML project zip, uploaded by you</small>
          </button>
          <button type="button" onClick={() => studio.exportKind("embed")}>
            Embed package
            <small>Same game plus an iframe page</small>
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

function openAi(studio: ReturnType<typeof useStudio>, action: "initialize" | "generate") {
  studio.setMenu(null);
  studio.setComposer(action);
}

function labelForSave(state: "saved" | "saving" | "error") {
  if (state === "saving") return "Saving";
  if (state === "error") return "Not saved";
  return "Saved";
}
