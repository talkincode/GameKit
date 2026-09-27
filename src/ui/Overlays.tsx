import { useEffect, useState } from "react";
import { useStudio } from "../studio/store";

export function Overlays() {
  const studio = useStudio();
  return (
    <>
      {studio.composer === "initialize" || studio.composer === "generate" ? (
        <PromptDialog
          title={studio.composer === "initialize" ? "Initialize project" : "Generate code"}
          copy={
            studio.composer === "initialize"
              ? "Describe the files you want. Nothing is written until you accept the diff."
              : "Describe the code. It is proposed as one file you can accept or reject."
          }
          busy={studio.aiBusy}
          onClose={() => studio.setComposer(null)}
          onSubmit={(prompt) => void studio.ask(studio.composer === "initialize" ? "initialize" : "generate", prompt)}
        />
      ) : null}
      {studio.composer === "asset" ? <AssetDialog /> : null}
      {studio.proposal ? <ProposalDialog /> : null}
      {studio.aiBusy && !studio.composer ? <div className="busy">Asking the model…</div> : null}
    </>
  );
}

function PromptDialog({
  title,
  copy,
  busy,
  onClose,
  onSubmit,
}: {
  title: string;
  copy: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  return (
    <div className="modal-back" role="presentation">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (prompt.trim()) onSubmit(prompt.trim());
        }}
      >
        <h2>{title}</h2>
        <p>{copy}</p>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} autoFocus />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="run" type="submit" disabled={busy || !prompt.trim()}>
            {busy ? "Working" : "Propose"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ProposalDialog() {
  const studio = useStudio();
  const proposal = studio.proposal;
  if (!proposal) return null;
  return (
    <div className="modal-back" role="presentation">
      <section className="modal wide">
        <h2>{proposal.title}</h2>
        {proposal.explanation ? <p>{proposal.explanation}</p> : null}
        <div className="diffs">
          {proposal.files.map((file) => (
            <article key={file.path}>
              <h3>{file.path}</h3>
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
          {!proposal.files.length ? <p>No file changes. Close this note when you are done.</p> : null}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={studio.rejectProposal}>
            {proposal.files.length ? "Reject" : "Close"}
          </button>
          {proposal.files.length ? (
            <button className="run" type="button" onClick={studio.acceptProposal}>
              Accept
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AssetDialog() {
  const studio = useStudio();
  const [prompt, setPrompt] = useState("32 pixel character, front view");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!studio.assetDraft) return;
    const copy = new Uint8Array(studio.assetDraft.bytes);
    const next = URL.createObjectURL(new Blob([copy], { type: studio.assetDraft.mediaType }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [studio.assetDraft]);

  return (
    <div className="modal-back" role="presentation">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          void studio.generateAsset(prompt);
        }}
      >
        <h2>Generate asset</h2>
        <p>The image stays here until you add it to the project.</p>
        <div className="seg">
          {(["sprite", "background", "tile", "icon"] as const).map((kind) => (
            <button key={kind} type="button" className={studio.assetKind === kind ? "on" : ""} onClick={() => studio.setAssetKind(kind)}>
              {kind}
            </button>
          ))}
        </div>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
        {url ? <img className="generated" src={url} alt="Generated asset" /> : null}
        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              studio.clearAsset();
              studio.setComposer(null);
            }}
          >
            Close
          </button>
          <button className="ghost" type="submit" disabled={studio.aiBusy || prompt.trim().length < 3}>
            {studio.aiBusy ? "Generating" : url ? "Another" : "Generate"}
          </button>
          <button className="run" type="button" disabled={!studio.assetDraft} onClick={studio.acceptAsset}>
            Add to project
          </button>
        </div>
      </form>
    </div>
  );
}
