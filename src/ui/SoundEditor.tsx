import { useEffect, useMemo, useRef, useState } from "react";
import {
  IDENTITY_EDIT,
  envelopeCurve,
  musicVoices,
  renderEdited,
  soundFileStem,
  waveformPeaks,
  type SoundEdit,
} from "../lib/audio/edit";
import { pygameSoundDemo, pygameSoundSnippet } from "../lib/audio/play";
import { presetsFor, soundPreset, type SoundPreset } from "../lib/audio/presets";
import type { MusicTrack, SfxLayer, SfxSpec, SoundSpec, Wave } from "../lib/audio/spec";
import { uniquePath } from "../lib/project";
import { useStudio } from "../studio/store";
import { text } from "./text";
import "./sound-editor.css";

const WAVES: Wave[] = ["sine", "triangle", "square", "saw", "noise"];

function withLayer(spec: SfxSpec, patch: Partial<SfxLayer>): SfxSpec {
  const [first, ...rest] = spec.layers;
  return { ...spec, layers: [{ ...first, ...patch }, ...rest] };
}

function rolesOf(spec: SoundSpec): Record<MusicTrack["role"], boolean> {
  if (spec.kind !== "music") return { lead: true, bass: false, hat: false };
  return {
    lead: spec.tracks.some((track) => track.role === "lead"),
    bass: spec.tracks.some((track) => track.role === "bass"),
    hat: spec.tracks.some((track) => track.role === "hat"),
  };
}

function selectedRoles(roles: Record<MusicTrack["role"], boolean>): MusicTrack["role"][] {
  return (["lead", "bass", "hat"] as const).filter((role) => roles[role]);
}

function Field({ label, value, min, max, step, testId, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  testId: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="sound-field">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        data-testid={testId}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span>{Number.isInteger(step) ? value : value.toFixed(step < 0.1 ? 2 : 1)}</span>
    </label>
  );
}

/**
 * Hear a sound, change it, and save that same WAV.
 * Presets work without an account. Asking the model to pick numbers still needs a login.
 */
export function SoundDialog() {
  const studio = useStudio();
  const opening = soundPreset(studio.soundKind === "music" ? "walk-music" : "jump-sfx");
  const [presetId, setPresetId] = useState(opening.id);
  const [spec, setSpec] = useState<SoundSpec>(opening.spec);
  const [edit, setEdit] = useState<SoundEdit>(opening.edit);
  const [roles, setRoles] = useState(rolesOf(opening.spec));
  const [prompt, setPrompt] = useState("");
  const [problem, setProblem] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [stageOpen, setStageOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState(false);
  const adopted = useRef(0);

  useEffect(() => {
    const recipe = studio.soundRecipe;
    if (!recipe || recipe.token === adopted.current) return;
    adopted.current = recipe.token;
    setSpec(recipe.spec);
    setEdit(IDENTITY_EDIT);
    setPresetId("custom");
    setRoles(rolesOf(recipe.spec));
    setSavedPath("");
    setStageOpen(false);
    setProblem("");
    setGenerated(true);
  }, [studio.soundRecipe]);

  const active = useMemo(() => (spec.kind === "music" ? musicVoices(spec, selectedRoles(roles)) : spec), [spec, roles]);
  const rendered = useMemo(() => renderEdited(active, edit), [active, edit]);
  const raw = useMemo(() => renderEdited(active, IDENTITY_EDIT), [active]);
  const url = useMemo(() => URL.createObjectURL(new Blob([new Uint8Array(rendered.wav)], { type: "audio/wav" })), [rendered]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const stem = soundFileStem(spec.name, spec.kind === "music" ? "music" : "sound");
  const suggested = `assets/${stem}.wav`;
  const taken = studio.project?.files.map((file) => file.path) ?? [];
  const path = savedPath || uniquePath(taken, suggested);
  const snippet = pygameSoundSnippet(path, edit.loop);
  const layer = spec.kind === "sfx" ? spec.layers[0] : null;
  const preset = SOUND_PRESET_OR_NULL(presetId);

  const applyPreset = (next: SoundPreset) => {
    setPresetId(next.id);
    setSpec(next.spec);
    setEdit(next.edit);
    setRoles(rolesOf(next.spec));
    studio.setSoundKind(next.kind);
    setSavedPath("");
    setStageOpen(false);
    setProblem("");
    setStatus("");
  };

  const markCustom = (next: SoundSpec) => {
    setPresetId("custom");
    setSpec(next);
    setSavedPath("");
  };

  const save = async (mainText?: string) => {
    setBusy(true);
    setProblem("");
    try {
      const outcome = await studio.saveSound({
        bytes: rendered.wav,
        suggested,
        reusePath: savedPath || undefined,
        mainText,
      });
      if (!outcome.ok) {
        setProblem(text.sounds.problem[outcome.reason]);
        return;
      }
      setSavedPath(outcome.path);
      setStatus(text.sounds.saved(outcome.path));
      setStageOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const peaks = waveformPeaks(rendered.pcm);
  const curve = layer ? envelopeCurve(layer) : [];
  const wavePath = peaks
    .map((peak, index) => {
      const x = (index / Math.max(1, peaks.length - 1)) * 100;
      return `M ${x} ${50 - peak * 46} L ${x} ${50 + peak * 46}`;
    })
    .join(" ");
  const curvePath = curve
    .map((point, index) => `${index === 0 ? "M" : "L"} ${(index / Math.max(1, curve.length - 1)) * 100} ${96 - point * 88}`)
    .join(" ");

  return (
    <div className="modal-back" role="presentation">
      <form
        className="modal sound-editor"
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
              onClick={() => applyPreset(soundPreset(kind === "music" ? "walk-music" : "jump-sfx"))}
            >
              {text.sounds.kinds[kind]}
            </button>
          ))}
        </div>
        <p>{text.sounds.presets}</p>
        <div className="sound-presets">
          {presetsFor(studio.soundKind).map((item) => (
            <button
              key={item.id}
              type="button"
              className={presetId === item.id ? "on" : ""}
              data-testid={`sound-preset-${item.id}`}
              onClick={() => applyPreset(item)}
            >
              {item.title}
            </button>
          ))}
        </div>
        {preset?.tags.includes("变体") ? <p>{text.sounds.variant}</p> : null}
        <textarea
          value={prompt}
          rows={2}
          placeholder={studio.soundKind === "sfx" ? text.sounds.promptSfx : text.sounds.promptMusic}
          onChange={(event) => setPrompt(event.target.value)}
        />
        {layer ? (
          <>
            <p>{text.sounds.wave}</p>
            <div className="sound-waves">
              {WAVES.map((wave) => (
                <button key={wave} type="button" className={layer.wave === wave ? "on" : ""} onClick={() => markCustom(withLayer(spec as SfxSpec, { wave }))}>
                  {text.sounds.waves[wave]}
                </button>
              ))}
            </div>
            <Field label={text.sounds.from} testId="sound-from" min={20} max={8000} step={10} value={layer.from} onChange={(from) => markCustom(withLayer(spec as SfxSpec, { from }))} />
            <Field label={text.sounds.to} testId="sound-to" min={20} max={8000} step={10} value={layer.to} onChange={(to) => markCustom(withLayer(spec as SfxSpec, { to }))} />
            <Field
              label={text.sounds.duration}
              testId="sound-duration"
              min={0.05}
              max={4}
              step={0.01}
              value={layer.duration}
              onChange={(duration) => markCustom(withLayer(spec as SfxSpec, { duration }))}
            />
            <Field label={text.sounds.attack} testId="sound-attack" min={0} max={0.4} step={0.005} value={layer.attack} onChange={(attack) => markCustom(withLayer(spec as SfxSpec, { attack }))} />
            <Field label={text.sounds.decay} testId="sound-decay" min={0} max={0.6} step={0.005} value={layer.decay} onChange={(decay) => markCustom(withLayer(spec as SfxSpec, { decay }))} />
            <Field label={text.sounds.sustain} testId="sound-sustain" min={0} max={1} step={0.01} value={layer.sustain} onChange={(sustain) => markCustom(withLayer(spec as SfxSpec, { sustain }))} />
            <Field label={text.sounds.release} testId="sound-release" min={0.01} max={0.6} step={0.005} value={layer.release} onChange={(release) => markCustom(withLayer(spec as SfxSpec, { release }))} />
            {spec.kind === "sfx" && spec.layers.length > 1 ? <p>{text.sounds.layers(spec.layers.length - 1)}</p> : null}
            <p>{text.sounds.envelope}</p>
            <svg className="sound-plot" viewBox="0 0 100 100" preserveAspectRatio="none" data-testid="sound-envelope" role="img" aria-label={text.sounds.envelope}>
              <path d={curvePath} />
            </svg>
          </>
        ) : spec.kind === "music" ? (
          <>
            <p data-testid="sound-rhythm">{text.sounds.rhythm(spec.bpm, spec.bars)}</p>
            <Field
              label={text.sounds.bpm}
              testId="sound-bpm"
              min={50}
              max={180}
              step={1}
              value={spec.bpm}
              onChange={(bpm) => markCustom({ ...spec, bpm: Math.round(bpm) })}
            />
            <Field
              label={text.sounds.duration}
              testId="sound-bars"
              min={2}
              max={8}
              step={1}
              value={spec.bars}
              onChange={(bars) => markCustom({ ...spec, bars: Math.round(bars) })}
            />
            <div className="sound-voices">
              {(["lead", "bass", "hat"] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  className={roles[role] ? "on" : ""}
                  aria-pressed={roles[role]}
                  data-testid={`sound-voice-${role}`}
                  onClick={() => {
                    const next = { ...roles, [role]: !roles[role] };
                    if (!selectedRoles(next).length) return;
                    setRoles(next);
                    setSavedPath("");
                  }}
                >
                  {text.sounds.voices[role]}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <Field
          label={text.sounds.volume}
          testId="sound-volume"
          min={0}
          max={1}
          step={0.05}
          value={edit.volume}
          onChange={(volume) => {
            setEdit({ ...edit, volume });
            setSavedPath("");
          }}
        />
        <Field
          label={text.sounds.trimStart}
          testId="sound-trim-start"
          min={0}
          max={Math.max(0.02, raw.seconds - 0.02)}
          step={0.01}
          value={edit.trimStart}
          onChange={(trimStart) => {
            setEdit({ ...edit, trimStart });
            setSavedPath("");
          }}
        />
        <Field
          label={text.sounds.trimEnd}
          testId="sound-trim-end"
          min={0.02}
          max={raw.seconds}
          step={0.01}
          value={edit.trimEnd <= 0 ? raw.seconds : edit.trimEnd}
          onChange={(trimEnd) => {
            setEdit({ ...edit, trimEnd: trimEnd >= raw.seconds - 0.001 ? 0 : trimEnd });
            setSavedPath("");
          }}
        />
        <label>
          <input
            type="checkbox"
            data-testid="sound-loop"
            checked={edit.loop}
            onChange={(event) => {
              setEdit({ ...edit, loop: event.target.checked });
              setSavedPath("");
            }}
          />{" "}
          {text.sounds.loop}
        </label>
        <p>{text.sounds.waveform}</p>
        <svg className="sound-plot sound-wave" viewBox="0 0 100 100" preserveAspectRatio="none" data-testid="sound-wave" role="img" aria-label={text.sounds.waveform}>
          <path d={wavePath} />
        </svg>
        <figure className="sound-preview">
          <audio controls src={url} data-testid="sound-preview" />
          <figcaption>{text.sounds.seconds(rendered.seconds.toFixed(1))}</figcaption>
          {spec.say ? <p className="quiet">{spec.say}</p> : null}
        </figure>
        <p className="asset-keep">{text.sounds.use(path)}</p>
        <p>{text.sounds.snippet}</p>
        <pre className="library-snippet sound-snippet" data-testid="sound-snippet">
          {snippet}
        </pre>
        {stageOpen ? (
          <div data-testid="sound-stage-confirm">
            <p>{text.sounds.stageHint}</p>
            <pre className="library-snippet" data-testid="sound-stage-preview">
              {pygameSoundDemo(path, edit.loop)}
            </pre>
            <div className="modal-actions">
              <button type="button" onClick={() => setStageOpen(false)}>
                {text.sounds.cancel}
              </button>
              <button type="button" className="run" data-testid="sound-stage-write" disabled={busy} onClick={() => void save(pygameSoundDemo(path, edit.loop))}>
                {text.sounds.stageConfirm}
              </button>
            </div>
          </div>
        ) : null}
        {problem ? (
          <p className="sound-problem" data-testid="sound-problem">
            {problem}
          </p>
        ) : null}
        {status ? <p data-testid="sound-status">{status}</p> : null}
        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              studio.clearSoundRecipe();
              studio.clearAsset();
              studio.setSoundOpen(false);
            }}
          >
            {text.sounds.close}
          </button>
          <button type="button" onClick={() => void navigator.clipboard.writeText(snippet).then(() => setCopied(true), () => setCopied(false))}>
            {copied ? text.sounds.copied : text.sounds.copyCode}
          </button>
          <button
            type="button"
            data-testid="sound-keep"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setProblem("");
              void studio
                .keepSound({
                  bytes: rendered.wav,
                  title: preset?.title || spec.say || (spec.kind === "music" ? "我的音乐" : "我的音效"),
                  kind: spec.kind,
                  tags: preset?.tags ?? [],
                })
                .then((outcome) => {
                  if (!outcome.ok) {
                    setProblem(text.sounds.problem[outcome.reason === "bad-audio" ? "bad-audio" : "keep-failed"]);
                    return;
                  }
                  setStatus(text.sounds.kept);
                })
                .finally(() => setBusy(false));
            }}
          >
            {text.sounds.keep}
          </button>
          <button type="button" data-testid="sound-stage" disabled={busy} onClick={() => setStageOpen(true)}>
            {text.sounds.stage}
          </button>
          <button className="ghost" type="submit" disabled={studio.aiBusy || prompt.trim().length < 2}>
            {studio.aiBusy ? text.sounds.busy : generated ? text.sounds.again : text.sounds.generate}
          </button>
          <button className="run" type="button" disabled={busy} onClick={() => void save()}>
            {text.sounds.accept}
          </button>
        </div>
      </form>
    </div>
  );
}

function SOUND_PRESET_OR_NULL(id: string): SoundPreset | null {
  return id === "custom" ? null : soundPreset(id);
}
