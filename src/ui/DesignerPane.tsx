import { useState } from "react";
import { designLines, type DesignCard } from "../lib/design";
import { useStudio, type Turn } from "../studio/store";
import { text } from "./text";

/**
 * The conversation pane: one card per round, newest at the bottom. It records
 * what the agent did; only 采用 changes the child's project.
 */
export function DesignerPane() {
  const studio = useStudio();
  const [draft, setDraft] = useState("");
  const ready = draft.trim().length > 0 && studio.canTurn;

  const send = () => {
    if (!ready) return;
    const request = draft.trim();
    setDraft("");
    void studio.startTurn(request);
  };

  return (
    <section className="pane" data-testid="pane">
      <header className="pane-head">
        <strong>{text.pane.title}</strong>
        {studio.turnBusy ? <span className="pane-busy">{text.pane.busy}</span> : null}
      </header>
      <div className="pane-scroll">
        {!studio.turns.length ? <Welcome design={studio.project?.design} /> : null}
        {studio.turns.map((turn) => (
          <TurnCard key={turn.id} turn={turn} />
        ))}
      </div>
      <Ask draft={draft} setDraft={setDraft} send={send} ready={ready} />
    </section>
  );
}

function Welcome({ design }: { design?: DesignCard }) {
  const lines = design ? designLines(design) : [];
  return (
    <div className="welcome">
      <h2>{text.pane.welcome}</h2>
      <p>{text.pane.examples}</p>
      {lines.length ? (
        <article className="card design" data-testid="current-design">
          <h3>
            {text.pane.current}
            {design?.title ? ` · ${design.title}` : ""}
          </h3>
          <ul>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      ) : null}
      <p className="quiet">{text.pane.hintPlay}</p>
    </div>
  );
}

function Ask({
  draft,
  setDraft,
  send,
  ready,
}: {
  draft: string;
  setDraft: (value: string) => void;
  send: () => void;
  ready: boolean;
}) {
  const studio = useStudio();
  if (studio.account.kind === "checking") return <div className="pane-locked">{text.account.checking}</div>;
  if (studio.account.kind !== "signed-in") {
    return (
      <div className="pane-locked">
        <p>{text.ai.needsSignIn}</p>
        <button className="run" type="button" onClick={studio.signIn}>
          {text.ai.signInToUse}
        </button>
      </div>
    );
  }
  return (
    <form
      className="pane-ask"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        value={draft}
        rows={2}
        aria-label={text.pane.placeholder}
        placeholder={studio.turns.length ? text.pane.placeholderNext : text.pane.placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="pane-actions">
        <button className="run" type="submit" disabled={!ready}>
          {studio.turns.length ? text.pane.sendNext : text.pane.send}
        </button>
        {studio.turnBusy ? (
          <button className="ghost" type="button" onClick={studio.cancelTurn}>
            {text.pane.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function mark(status: Turn["steps"][number]["status"]): string {
  if (status === "done") return "✓";
  if (status === "failed") return "×";
  return "•";
}

function TurnCard({ turn }: { turn: Turn }) {
  return turn.kind === "explain" ? <ExplainTurn turn={turn} /> : <DesignTurn turn={turn} />;
}

function ExplainTurn({ turn }: { turn: Turn }) {
  return (
    <article className="turn explain" data-testid="explain-turn">
      <p className="said">
        <em>{text.pane.youSaid}</em>
        {turn.request}
      </p>
      <p className="answer">{turn.answer ?? text.pane.explainBusy}</p>
    </article>
  );
}

function DesignTurn({ turn }: { turn: Turn }) {
  const studio = useStudio();
  const outcome = turn.outcome;
  const showCandidate = !!turn.candidate && !turn.adopted && !turn.discarded;
  const canAdopt = showCandidate && outcome?.kind === "ready";
  return (
    <article className={`turn design ${outcome?.kind ?? "running"}`} data-testid="design-turn">
      <p className="said">
        <em>{text.pane.youSaid}</em>
        {turn.request}
      </p>
      <ol className="steps">
        {turn.steps.map((step) => (
          <li key={step.key} className={`step ${step.status}`}>
            <span className="mark" aria-hidden="true">
              {mark(step.status)}
            </span>
            <span className="label">{text.steps[step.kind]}</span>
            <span className="quiet">{step.detail ? step.detail.slice(0, 120) : ""}</span>
          </li>
        ))}
      </ol>
      {turn.design ? (
        <article className="card design" data-testid="turn-design">
          <h3>{turn.design.title || text.pane.candidateTitle}</h3>
          <ul>
            {designLines(turn.design).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {turn.say ? <p className="say">{turn.say}</p> : null}
        </article>
      ) : null}
      {showCandidate && turn.candidate ? (
        <div className="candidate" data-testid="candidate">
          <p className="quiet">{text.pane.changed(turn.candidate.diff.length)}</p>
          {turn.candidate.diff.length ? (
            <details className="diff-view">
              <summary>{text.pane.showDiff}</summary>
              {turn.candidate.diff.map((file) => (
                <article key={file.path}>
                  <h4>{file.path}</h4>
                  <pre>
                    {file.rows.map((row, index) => (
                      <span key={`${file.path}-${index}`} className={`diff-${row.kind}`}>
                        {row.kind === "add" ? "+ " : row.kind === "del" ? "- " : "  "}
                        {row.text}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                </article>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}
      {turn.adopted ? <p className="turn-foot good">{text.pane.adopted}</p> : null}
      {turn.discarded ? <p className="turn-foot">{text.pane.discarded}</p> : null}
      {!turn.adopted && !turn.discarded && outcome && outcomeCopy(turn) ? (
        <p className={`turn-foot ${outcome.kind}`}>{outcomeCopy(turn)}</p>
      ) : null}
      {canAdopt ? (
        <div className="turn-actions">
          <button
            className="run"
            type="button"
            data-testid="adopt"
            disabled={!studio.project || turn.candidate?.project.id !== studio.project.id}
            onClick={studio.adoptCandidate}
          >
            {text.pane.adopt}
          </button>
          <button className="ghost" type="button" data-testid="discard" onClick={studio.discardCandidate}>
            {text.pane.discard}
          </button>
        </div>
      ) : null}
    </article>
  );
}

/** One kid-facing sentence for how the round ended. */
function outcomeCopy(turn: Turn): string {
  const outcome = turn.outcome;
  if (!outcome) return "";
  if (outcome.kind === "cancelled") return text.pane.cancelled;
  if (outcome.kind === "blocked") return text.pane.blocked;
  if (outcome.kind === "failed") return text.pane.failed;
  if (outcome.unverified) return text.pane.unverified;
  return "";
}
