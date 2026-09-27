import { RUNTIME } from "../lib/build";
import { useStudio } from "../studio/store";

export function BottomPanel() {
  const studio = useStudio();
  const errors = studio.problems.filter((item) => item.severity === "error").length;

  return (
    <section className="bottom">
      <div className="bottom-tabs">
        <button type="button" className={studio.bottomTab === "console" ? "on" : ""} onClick={() => studio.setBottomTab("console")}>
          Console
        </button>
        <button type="button" className={studio.bottomTab === "problems" ? "on" : ""} onClick={() => studio.setBottomTab("problems")}>
          Problems
          {studio.problems.length ? <b>{studio.problems.length}</b> : null}
        </button>
        <button type="button" className={studio.bottomTab === "debug" ? "on" : ""} onClick={() => studio.setBottomTab("debug")}>
          Debug
        </button>
        {errors ? <span className="bottom-note">{errors} blocking</span> : null}
      </div>
      {studio.bottomTab === "console" ? <pre className="console">{studio.consoleText || "Run a project to see pygame output."}</pre> : null}
      {studio.bottomTab === "problems" ? (
        <ul className="problems">
          {studio.problems.map((problem) => (
            <li key={problem.id}>
              <button
                type="button"
                onClick={() => {
                  if (problem.path) studio.setPath(problem.path);
                }}
              >
                <em>{problem.severity}</em>
                <span>
                  {problem.path ? `${problem.path}${problem.line ? `:${problem.line}` : ""} — ` : ""}
                  {problem.message}
                </span>
              </button>
            </li>
          ))}
          {!studio.problems.length ? <li className="quiet">No problems.</li> : null}
        </ul>
      ) : null}
      {studio.bottomTab === "debug" ? (
        <div className="debug">
          <dl>
            <div>
              <dt>Runtime</dt>
              <dd>pygame-ce via pygbag {RUNTIME.version}</dd>
            </div>
            <div>
              <dt>Python</dt>
              <dd>{RUNTIME.pybuild}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{studio.runState}</dd>
            </div>
            <div>
              <dt>FPS</dt>
              <dd>{studio.fps === null ? "—" : studio.fps.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Frame time</dt>
              <dd>{studio.frameMs === null ? "—" : `${studio.frameMs.toFixed(1)} ms`}</dd>
            </div>
          </dl>
          <div>
            <h3>Input</h3>
            <ol>
              {studio.inputs.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
              {!studio.inputs.length ? <li className="quiet">Click the preview, then use the keyboard or mouse.</li> : null}
            </ol>
          </div>
          <p className="quiet">
            This pass shows the console, errors, frame timing, and input. Hitboxes and sprite bounds are left for a later version.
          </p>
        </div>
      ) : null}
    </section>
  );
}
