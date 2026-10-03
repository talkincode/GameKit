import { PALETTE } from "../lib/pixel/palette";
import { text } from "./text";

/** The default colours as buttons. `null` stands for transparent. */
export function PixelSwatches({
  label,
  value,
  onPick,
  transparent = false,
}: {
  label: string;
  value: string | null;
  onPick: (hex: string | null) => void;
  transparent?: boolean;
}) {
  return (
    <div className="pixel-swatches" role="group" aria-label={label}>
      {transparent ? (
        <button
          type="button"
          className={`pixel-swatch clear${value === null ? " on" : ""}`}
          aria-label={text.pixel.transparentColor}
          aria-pressed={value === null}
          title={text.pixel.transparentColor}
          onClick={() => onPick(null)}
        />
      ) : null}
      {PALETTE.map((hex) => (
        <button
          key={hex}
          type="button"
          className={`pixel-swatch${value === hex ? " on" : ""}`}
          style={{ background: hex }}
          aria-label={text.pixel.colors[hex] ?? hex}
          aria-pressed={value === hex}
          title={text.pixel.colors[hex] ?? hex}
          onClick={() => onPick(hex)}
        />
      ))}
    </div>
  );
}
