import { useEffect } from "react";
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
        </div>
      </section>
    </div>
  );
}
