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

  const kind = studio.assetKind;
  const sized = kind === "sprite" || kind === "icon";

  return (
    <div className="modal-back" role="presentation">
      <form
        className="modal"
        data-testid="asset-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (prompt.trim().length >= 2) void studio.generateAsset(prompt);
        }}
      >
        <h2>{text.assets.title}</h2>
        <p>{text.assets.copy}</p>
        <div className="seg">
          {(["sprite", "background", "tile", "icon"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={studio.assetKind === item ? "on" : ""}
              onClick={() => studio.setAssetKind(item)}
            >
              {text.assets.kinds[item]}
            </button>
          ))}
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={2}
          placeholder={text.assets.prompt}
        />
        {sized ? (
          <div className="asset-options">
            <div className="asset-size">
              <span className="asset-size-label" id="asset-size-label">
                {text.assets.size}
              </span>
              <span className="seg small" role="group" aria-labelledby="asset-size-label">
                {([32, 48, 64] as const).map((px) => (
                  <button
                    key={px}
                    type="button"
                    aria-pressed={studio.assetSize === px}
                    className={studio.assetSize === px ? "on" : ""}
                    onClick={() => studio.setAssetSize(px)}
                  >
                    {text.assets.sizeValue(px)}
                  </button>
                ))}
              </span>
            </div>
            <label className="asset-cut">
              <input
                type="checkbox"
                checked={studio.assetCut}
                onChange={(event) => studio.setAssetCut(event.target.checked)}
              />
              <span>
                {text.assets.cut}
                <small>{text.assets.cutHint}</small>
              </span>
            </label>
          </div>
        ) : null}
        {url && studio.assetDraft ? (
          <figure className="asset-preview">
            <img className="generated" src={url} alt={text.assets.title} />
            <figcaption>{text.assets.pixel(studio.assetDraft.width, studio.assetDraft.height)}</figcaption>
          </figure>
        ) : null}
        {studio.assetDraft?.note ? <p className="asset-note">{studio.assetDraft.note}</p> : null}
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
          <button className="ghost" type="submit" disabled={studio.aiBusy || prompt.trim().length < 2}>
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
