import { RUNTIME } from "../lib/build";
import { explainConsole, explainDiagnostic } from "../lib/kid-error";
import { useStudio } from "../studio/store";
import { text } from "./text";

function ConsoleHint({ text: consoleText }: { text: string }) {
  const explained = explainConsole(consoleText);
  if (!explained) return null;
  return (
    <div className="kid-error" data-testid="console-kid-error">
      <p>{explained.kid}</p>
      <details>
        <summary>{text.codeExtra.technical}</summary>
        <p>{explained.technical}</p>
      </details>
    </div>
  );
}

export function BottomPanel() {
  const studio = useStudio();

  return (
    <section className="bottom">
      <div className="bottom-tabs">
        <button type="button" className={studio.bottomTab === "console" ? "on" : ""} onClick={() => studio.setBottomTab("console")}>
          {text.code.console}
        </button>
        <button type="button" className={studio.bottomTab === "problems" ? "on" : ""} onClick={() => studio.setBottomTab("problems")}>
          {text.code.problems}
          {studio.problems.length ? <b>{studio.problems.length}</b> : null}
        </button>
        <button type="button" className={studio.bottomTab === "debug" ? "on" : ""} onClick={() => studio.setBottomTab("debug")}>
          {text.code.debug}
        </button>
      </div>
      {studio.bottomTab === "console" ? (
        <>
          <ConsoleHint text={studio.consoleText} />
          <pre className="console">{studio.consoleText || text.stage.empty}</pre>
        </>
      ) : null}
      {studio.bottomTab === "problems" ? (
        <ul className="problems">
          {studio.problems.map((problem) => {
            const explained = explainDiagnostic(problem.message);
            return (
              <li key={problem.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (problem.path) studio.setPath(problem.path);
                  }}
                >
                  <em>{problem.severity === "error" ? "问题" : "提醒"}</em>
                  <span>
                    {problem.path ? `${problem.path}${problem.line ? `:${problem.line}` : ""} — ` : ""}
                    {explained?.kid ?? problem.message}
                  </span>
                </button>
                {explained ? (
                  <details className="kid-technical">
                    <summary>{text.codeExtra.technical}</summary>
                    <p>{explained.technical}</p>
                  </details>
                ) : null}
              </li>
            );
          })}
          {!studio.problems.length ? <li className="quiet">{text.code.noProblems}</li> : null}
        </ul>
      ) : null}
      {studio.bottomTab === "debug" ? (
        <div className="debug">
          <dl>
            <div>
              <dt>runtime</dt>
              <dd>{text.stage.runtime(RUNTIME.version, RUNTIME.pybuild)}</dd>
            </div>
            <div>
              <dt>state</dt>
              <dd>{studio.runState}</dd>
            </div>
            <div>
              <dt>FPS</dt>
              <dd>{studio.fps === null ? "—" : studio.fps.toFixed(1)}</dd>
            </div>
            <div>
              <dt>frame</dt>
              <dd>{studio.frameMs === null ? "—" : `${studio.frameMs.toFixed(1)} ms`}</dd>
            </div>
          </dl>
          <div>
            <h3>输入</h3>
            <ol>
              {studio.inputs.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
              {!studio.inputs.length ? <li className="quiet">{text.code.runHint}</li> : null}
            </ol>
          </div>
        </div>
      ) : null}
    </section>
  );
}
