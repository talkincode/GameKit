/** Dialogs that stand on their own: the asset maker. Everything the agent does
 * lives in the pane, not in a modal. */
import { useEffect, useState } from "react";
import { useStudio } from "../studio/store";
import { text } from "./text";

export function Overlays() {
  const studio = useStudio();
  return <>{studio.assetOpen ? <AssetDialog /> : null}</>;
}

function AssetDialog() {
  const studio = useStudio();
  const [prompt, setPrompt] = useState("");
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
          if (prompt.trim().length >= 3) void studio.generateAsset(prompt);
        }}
      >
        <h2>{text.assets.title}</h2>
        <p>{text.assets.copy}</p>
        <div className="seg">
          {(["sprite", "background", "tile", "icon"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={studio.assetKind === kind ? "on" : ""}
              onClick={() => studio.setAssetKind(kind)}
            >
              {text.assets.kinds[kind]}
            </button>
          ))}
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder={text.assets.prompt}
        />
        {url ? <img className="generated" src={url} alt={text.assets.title} /> : null}
        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              studio.clearAsset();
              studio.setAssetOpen(false);
            }}
          >
            {text.assets.close}
          </button>
          <button className="ghost" type="submit" disabled={studio.aiBusy || prompt.trim().length < 3}>
            {studio.aiBusy ? text.assets.busy : url ? text.assets.again : text.assets.generate}
          </button>
          <button className="run" type="button" disabled={!studio.assetDraft} onClick={studio.acceptAsset}>
            {text.assets.accept}
          </button>
        </div>
      </form>
    </div>
  );
}
