import { useState } from "react";
import { formatFailure, type PublicFailure } from "../../shared/assistant-error";
import { text } from "./text";

/**
 * The kid still sees one short sentence. This is the folded technical part:
 * category, request id, time, and a public detail an adult can copy.
 */
export function ErrorDetail({
  failure,
  summary = "",
  testId = "error-detail",
}: {
  failure: PublicFailure;
  summary?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const label = text.logs.codes[failure.code];

  const copy = async () => {
    const block = formatFailure(failure, summary);
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="error-detail" data-testid={testId}>
      <button type="button" className="error-detail-toggle" data-testid={`${testId}-toggle`} onClick={() => setOpen((value) => !value)}>
        {open ? text.logs.hide : text.logs.detail}
      </button>
      {open ? (
        <div className="error-detail-body" data-testid={`${testId}-body`}>
          <p>
            {text.logs.kind}：{label}
            <span className="error-code">{failure.code}</span>
          </p>
          <p>
            {text.logs.requestId}：<code data-testid={`${testId}-request-id`}>{failure.requestId}</code>
          </p>
          <p>
            {text.logs.time}：<time dateTime={failure.at}>{failure.at}</time>
          </p>
          <p>
            {text.logs.technical}：{failure.detail}
          </p>
          <button type="button" className="ghost" data-testid={`${testId}-copy`} onClick={() => void copy()}>
            {copied ? text.logs.copied : text.logs.copy}
          </button>
        </div>
      ) : null}
    </div>
  );
}
