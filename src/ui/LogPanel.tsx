import { useEffect, useMemo, useState } from "react";
import { isAssistantCode, type PublicFailure } from "../../shared/assistant-error";
import { clearLogs, hydrateLogs, readLogs, subscribeLogs, type LogArea, type LogEntry } from "../lib/log/journal";
import { useStudio } from "../studio/store";
import { ErrorDetail } from "./ErrorDetail";
import { text } from "./text";

const FILTERS: { id: "all" | LogArea; label: string }[] = [
  { id: "all", label: text.logs.all },
  { id: "assistant", label: text.logs.assistant },
  { id: "preview", label: text.logs.preview },
  { id: "export", label: text.logs.export },
];

function asFailure(entry: LogEntry): PublicFailure | null {
  if (entry.ok || entry.code === "ok" || !isAssistantCode(entry.code)) return null;
  return {
    requestId: entry.requestId,
    code: entry.code,
    message: entry.message,
    detail: entry.detail,
    at: entry.at,
  };
}

/**
 * Local log. No sign-in, no upload. The ring lives in memory and IndexedDB.
 */
export function LogPanel() {
  const studio = useStudio();
  const [rows, setRows] = useState<LogEntry[]>(() => readLogs());
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const open = studio.logsOpen;

  useEffect(() => {
    void hydrateLogs();
    return subscribeLogs(setRows);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") studio.setLogsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, studio]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== "all" && row.area !== filter) return false;
      if (problemsOnly && row.ok) return false;
      if (!needle) return true;
      const hay = `${row.summary} ${row.message} ${row.requestId} ${row.code} ${row.detail}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, filter, query, problemsOnly]);

  if (!open) return null;

  return (
    <div className="modal-back" role="presentation">
      <section className="modal logs" data-testid="logs-panel" aria-label={text.logs.title}>
        <header className="projects-head">
          <h2>{text.logs.title}</h2>
          <input
            className="projects-search"
            type="search"
            value={query}
            placeholder={text.logs.search}
            aria-label={text.logs.search}
            data-testid="logs-search"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="ghost" type="button" onClick={() => studio.setLogsOpen(false)}>
            {text.logs.close}
          </button>
        </header>
        <p className="quiet">{text.logs.hint}</p>
        <div className="logs-filters" role="group" aria-label={text.logs.title}>
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? "on" : ""}
              aria-pressed={filter === item.id}
              data-testid={`logs-filter-${item.id}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
          <label className="logs-problems">
            <input
              type="checkbox"
              checked={problemsOnly}
              data-testid="logs-problems-only"
              onChange={(event) => setProblemsOnly(event.target.checked)}
            />
            {text.logs.problemsOnly}
          </label>
        </div>
        {shown.length === 0 ? <p data-testid="logs-empty">{text.logs.empty}</p> : null}
        <ul className="logs-list">
          {shown.map((row) => {
            const failure = asFailure(row);
            const codeLabel = text.logs.codes[row.code];
            return (
              <li key={row.id} className={row.ok ? "ok" : "bad"} data-testid="log-row" data-request-id={row.requestId}>
                <p>
                  <strong>{row.ok ? text.logs.ok : row.message}</strong>
                  <span className="quiet">
                    {text.logs[row.area]} · {codeLabel}
                  </span>
                </p>
                {row.summary ? <p className="quiet">{row.summary}</p> : null}
                <p className="log-id">
                  <code>{row.requestId}</code>
                  <time dateTime={row.at}>{row.at}</time>
                </p>
                {failure ? <ErrorDetail failure={failure} summary={row.summary} testId="log-error-detail" /> : null}
              </li>
            );
          })}
        </ul>
        {confirming ? (
          <p className="logs-confirm" data-testid="logs-clear-ask">
            {text.logs.clearAsk}
            <button
              type="button"
              className="danger"
              data-testid="logs-clear-confirm"
              onClick={() => {
                clearLogs();
                setConfirming(false);
              }}
            >
              {text.logs.confirmClear}
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>
              {text.logs.cancel}
            </button>
          </p>
        ) : (
          <button type="button" className="ghost" data-testid="logs-clear" disabled={rows.length === 0} onClick={() => setConfirming(true)}>
            {text.logs.clear}
          </button>
        )}
      </section>
    </div>
  );
}
