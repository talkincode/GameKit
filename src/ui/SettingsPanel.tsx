import { useEffect, useState } from "react";
import { BUDGET_CHOICES, budgetFor } from "../lib/settings";
import { useStudio } from "../studio/store";
import { text } from "./text";

/**
 * 设置：一台电脑上的一套偏好。目前只有「小助手记得多少」，后面会添更多。
 * Everything here is local; nothing is uploaded.
 */
export function SettingsPanel() {
  const studio = useStudio();
  const open = studio.settingsOpen;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") studio.setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, studio]);

  if (!open) return null;
  const plan = budgetFor(studio.settings.agentBudget, studio.modelLimit);
  const choice = studio.settings.agentBudget;

  return (
    <div className="modal-back" role="presentation">
      <section className="modal settings" data-testid="settings-panel" aria-label={text.settings.title}>
        <header className="projects-head">
          <h2>⚙️ {text.settings.title}</h2>
          <button
            className="ghost"
            type="button"
            title={text.settings.close}
            aria-label={text.settings.close}
            data-testid="settings-close"
            onClick={() => studio.setSettingsOpen(false)}
          >
            ✕
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-group">
            <h3>{text.settings.memory}</h3>
            <p className="quiet">{text.settings.memoryHint}</p>
            <div className="settings-choices" role="radiogroup" aria-label={text.settings.memory}>
              <button
                type="button"
                role="radio"
                aria-checked={choice === "auto"}
                className={choice === "auto" ? "on" : ""}
                data-testid="budget-auto"
                onClick={() => studio.updateSettings({ agentBudget: "auto" })}
              >
                {text.settings.auto}
                <small>{text.settings.autoDetail(plan.modelLimit, budgetFor("auto", studio.modelLimit).tokens)}</small>
              </button>
              {BUDGET_CHOICES.map((tokens) => (
                <button
                  key={tokens}
                  type="button"
                  role="radio"
                  aria-checked={choice === tokens}
                  className={choice === tokens ? "on" : ""}
                  onClick={() => studio.updateSettings({ agentBudget: tokens })}
                >
                  {text.settings.tokens(tokens)}
                  {studio.modelLimit !== null && tokens > plan.modelLimit * 0.75 ? (
                    <small className="warn">{text.settings.tooBig(text.settings.tokens(plan.tokens))}</small>
                  ) : null}
                </button>
              ))}
            </div>
            <p className="quiet" data-testid="settings-summary">
              {text.settings.current(budgetFor(choice, studio.modelLimit).tokens)}
            </p>
          </section>

          <section className="settings-group collab-group" data-testid="collab-settings">
            <h3>{text.collab.title}</h3>
            <p className="quiet">{text.collab.hint}</p>
            <div className="collab-status-row">
              <span className={`collab-status ${studio.collabActive ? "active" : ""}`} data-testid="collab-status">
                {studio.collabActive ? text.collab.statusActive : text.collab.statusInactive}
              </span>
              <button
                type="button"
                className={studio.collabActive ? "ghost" : "run"}
                data-testid="collab-toggle"
                onClick={() => {
                  if (studio.collabActive) {
                    void studio.stopCollab();
                  } else {
                    void studio.startCollab();
                  }
                }}
              >
                {studio.collabActive ? text.collab.stop : text.collab.start}
              </button>
            </div>
            {studio.collabActive ? (
              <div className="collab-url-box" data-testid="collab-url-box">
                <label className="quiet">{text.collab.serverUrl}</label>
                <div className="collab-url-input-row">
                  <input
                    type="text"
                    readOnly
                    value={studio.collabUrl}
                    data-testid="collab-url"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type="button"
                    className="ghost"
                    data-testid="collab-copy-url"
                    onClick={() => {
                      void navigator.clipboard.writeText(studio.collabUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? text.collab.serverUrlCopied : text.collab.serverUrlCopy}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}
