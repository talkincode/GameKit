import { useMemo, useState } from "react";
import { MAX_NEW_SIDE, SIZE_PRESETS, checkSize, defaultImagePath, imagePath } from "../lib/pixel/rules";
import { uniquePath } from "../lib/project";
import { useStudio } from "../studio/store";
import { PixelSwatches } from "./PixelSwatches";
import { text } from "./text";
import "./pixel-editor.css";

/** 新建图片: name, size and background. Nothing is written until the child saves from the editor. */
export function PixelNewDialog() {
  const studio = useStudio();
  const paths = useMemo(() => studio.project?.files.map((file) => file.path) ?? [], [studio.project]);
  const [name, setName] = useState(() => defaultImagePath(paths));
  const [width, setWidth] = useState("32");
  const [height, setHeight] = useState("32");
  const [solid, setSolid] = useState(false);
  const [color, setColor] = useState<string>("#f4f4f4");
  const [tried, setTried] = useState(false);

  const resolved = imagePath(name);
  const taken = resolved !== null && paths.includes(resolved);
  const size = checkSize(width, height);
  const nameProblem = name.trim() && !resolved ? text.pixel.nameBad : null;
  const sizeProblem = !size.ok ? sizeText(size.field, size.reason) : null;

  const submit = () => {
    setTried(true);
    if (!resolved || taken || !size.ok) return;
    studio.startPixelNew({ path: resolved, width, height, background: solid ? color : null });
  };

  return (
    <div className="modal-back" role="presentation">
      <form
        className="modal pixel-new"
        data-testid="pixel-new-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pixel-new-title"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") studio.setPixelNewOpen(false);
        }}
      >
        <h2 id="pixel-new-title">{text.pixel.newTitle}</h2>
        <p>{text.pixel.newCopy}</p>

        <label className="pixel-field">
          <span>{text.pixel.name}</span>
          <input
            value={name}
            data-testid="pixel-name"
            autoFocus
            spellCheck={false}
            aria-invalid={Boolean(nameProblem) || taken}
            onChange={(event) => setName(event.target.value)}
          />
          <small>{text.pixel.nameHint}</small>
        </label>
        {nameProblem || (tried && !resolved) ? (
          <p className="pixel-problem" role="alert" data-testid="pixel-name-problem">
            {text.pixel.nameBad}
          </p>
        ) : null}
        {taken && resolved ? (
          <p className="pixel-problem" role="alert" data-testid="pixel-name-taken">
            {text.pixel.nameTaken(uniquePath(paths, resolved))}{" "}
            <button type="button" className="pixel-link" onClick={() => setName(uniquePath(paths, resolved))}>
              {text.pixel.useName(uniquePath(paths, resolved))}
            </button>
          </p>
        ) : null}

        <div className="pixel-field">
          <span id="pixel-size-label">{text.pixel.size}</span>
          <span className="seg small" role="group" aria-labelledby="pixel-size-label">
            {SIZE_PRESETS.map((px) => {
              const on = width === String(px) && height === String(px);
              return (
                <button
                  key={px}
                  type="button"
                  className={on ? "on" : ""}
                  aria-pressed={on}
                  onClick={() => {
                    setWidth(String(px));
                    setHeight(String(px));
                  }}
                >
                  {text.pixel.sizeValue(px)}
                </button>
              );
            })}
          </span>
          <span className="pixel-size-inputs">
            <label>
              <span>{text.pixel.width}</span>
              <input
                value={width}
                inputMode="numeric"
                data-testid="pixel-width"
                aria-invalid={!size.ok && size.field === "width"}
                onChange={(event) => setWidth(event.target.value)}
              />
            </label>
            <span aria-hidden="true">×</span>
            <label>
              <span>{text.pixel.height}</span>
              <input
                value={height}
                inputMode="numeric"
                data-testid="pixel-height"
                aria-invalid={!size.ok && size.field === "height"}
                onChange={(event) => setHeight(event.target.value)}
              />
            </label>
            <span>{text.pixel.unit}</span>
          </span>
        </div>
        {sizeProblem ? (
          <p className="pixel-problem" role="alert" data-testid="pixel-size-problem">
            {sizeProblem}
          </p>
        ) : null}

        <div className="pixel-field">
          <span id="pixel-bg-label">{text.pixel.background}</span>
          <span className="seg small" role="group" aria-labelledby="pixel-bg-label">
            <button type="button" className={solid ? "" : "on"} aria-pressed={!solid} onClick={() => setSolid(false)}>
              {text.pixel.transparent}
            </button>
            <button type="button" className={solid ? "on" : ""} aria-pressed={solid} onClick={() => setSolid(true)}>
              {text.pixel.solid}
            </button>
          </span>
          {solid ? (
            <PixelSwatches label={text.pixel.solidColor} value={color} onPick={(hex) => hex && setColor(hex)} />
          ) : null}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={() => studio.setPixelNewOpen(false)}>
            {text.pixel.cancel}
          </button>
          <button className="run" type="submit" data-testid="pixel-start">
            {text.pixel.start}
          </button>
        </div>
      </form>
    </div>
  );
}

function sizeText(field: "width" | "height", reason: "number" | "small" | "big"): string {
  const side = field === "width" ? text.pixel.width : text.pixel.height;
  if (reason === "number") return text.pixel.sizeNumber(side);
  if (reason === "small") return text.pixel.sizeSmall(side);
  return text.pixel.sizeBig(side, MAX_NEW_SIDE);
}
