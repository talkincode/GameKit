/** Dialogs that stand on their own: the asset maker. Everything the agent does
 * lives in the pane, not in a modal. */
import { useEffect, useState } from "react";
import { useStudio } from "../studio/store";
import { PixelEditor } from "./PixelEditor";
import { PixelNewDialog } from "./PixelNewDialog";
import { text } from "./text";

export function Overlays() {
  const studio = useStudio();
  return (
    <>
      {studio.assetOpen ? <AssetDialog /> : null}
      {studio.soundOpen ? <SoundDialog /> : null}
      {studio.pixelNewOpen ? <PixelNewDialog /> : null}
      <PixelEditor />
    </>
  );
}

/**
 * 生成声音: the child describes a sound, the model picks the numbers, and the
 * browser renders the samples (src/lib/audio). The preview plays exactly the file
 * that will be stored.
 */
function SoundDialog() {
  const studio = useStudio();
  const [prompt, setPrompt] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!studio.assetDraft?.sound) return;
    const copy = new Uint8Array(studio.assetDraft.bytes);
    const next = URL.createObjectURL(new Blob([copy], { type: studio.assetDraft.mediaType }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [studio.assetDraft]);

  const draft = studio.assetDraft?.sound ? studio.assetDraft : null;

  return (
    <div className="modal-back" role="presentation">
      <form
        className="modal"
        data-testid="sound-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (prompt.trim().length >= 2) void studio.generateSound(prompt);
        }}
      >
        <h2>{text.sounds.title}</h2>
        <p>{text.sounds.copy}</p>
        <div className="seg">
          {(["sfx", "music"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={studio.soundKind === kind ? "on" : ""}
              onClick={() => studio.setSoundKind(kind)}
            >
              {text.sounds.kinds[kind]}
            </button>
          ))}
        </div>
        <textarea
          value={prompt}
          rows={2}
          placeholder={studio.soundKind === "sfx" ? text.sounds.promptSfx : text.sounds.promptMusic}
          onChange={(event) => setPrompt(event.target.value)}
        />
        {url && draft?.sound ? (
          <figure className="sound-preview">
            <audio controls src={url} data-testid="sound-preview" />
            <figcaption>{text.sounds.seconds(draft.sound.seconds.toFixed(1))}</figcaption>
            {draft.sound.say ? <p className="quiet">{draft.sound.say}</p> : null}
          </figure>
        ) : null}
        {draft ? <p className="asset-keep">{text.sounds.use(draft.suggested)}</p> : null}
        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              studio.clearAsset();
              studio.setSoundOpen(false);
            }}
          >
            {text.sounds.close}
          </button>
          <button className="ghost" type="submit" disabled={studio.aiBusy || prompt.trim().length < 2}>
            {studio.aiBusy ? text.sounds.busy : url ? text.sounds.again : text.sounds.generate}
          </button>
          <button className="run" type="button" disabled={!draft} onClick={studio.acceptAsset}>
            {text.sounds.accept}
          </button>
        </div>
      </form>
    </div>
  );
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
            <button type="button" className="ghost" data-testid="pixel-edit-draft" onClick={studio.editDraftPixels}>
              {text.pixel.editDraft}
            </button>
          </figure>
        ) : null}
        {studio.assetDraft?.note ? <p className="asset-note">{studio.assetDraft.note}</p> : null}
        {studio.assetDraft ? <p className="asset-keep">{text.assets.keepHint}</p> : null}
        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              // Closing keeps the picture: nothing is lost until 保存到项目 happens.
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
