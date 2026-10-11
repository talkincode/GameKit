import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { KEPT_PACK_ID, loadKeptPack } from "../lib/audio/kept";
import { clearCatalogCache, loadAssetBytes, loadLibrary, packAssetUrl } from "../lib/assets/catalog";
import {
  describeLibraryCopy,
  libraryCopyFrom,
  libraryDest,
  type LibraryAssetCopy,
  type LibraryChoice,
  type LibraryExample,
  type LibraryPlan,
} from "../lib/assets/copy";
import { assetIntroSpec, attributionView, detailActions, frameOrigin, previewScale, type SecondaryAction } from "../lib/assets/detail";
import { assetDisplayName } from "../lib/assets/display";
import { filterAssets, libraryFilterGroups, relatedAssets } from "../lib/assets/filter";
import { oggPreviewWavPath } from "../lib/assets/preview-audio";
import type { AssetCategory, AssetPack, CatalogAsset } from "../lib/assets/schema";
import { soundMark, type SoundMark } from "../lib/assets/sound-mark";
import { LibraryPlayer } from "./LibraryPlayer";
import { pygameDemoMain, pygameSnippet, type SnippetAsset } from "../lib/assets/snippet";
import { useStudio } from "../studio/store";
import { text } from "./text";

/**
 * Built-in asset library. Pack JSON and pictures load only after this opens.
 * Copying goes through the studio, which snapshots the project first.
 */

type Row = { pack: AssetPack; asset: CatalogAsset };
type OpenIntent = "copy" | "sprite";
type Prepared = { copy: LibraryAssetCopy; plan: LibraryPlan };
type Pending = Prepared & { intent: OpenIntent };

function snippetOf(asset: CatalogAsset): SnippetAsset {
  return {
    title: asset.title,
    licenseName: asset.license.name,
    licenseSpdx: asset.license.spdx,
    author: asset.author,
    source: asset.source,
    attribution: asset.attribution,
    frameWidth: asset.animation?.frameWidth ?? asset.width ?? 0,
    frameHeight: asset.animation?.frameHeight ?? asset.height ?? 0,
    media: asset.mediaType.startsWith("audio/") ? "audio" : "image",
    loop: asset.category === "music",
  };
}

export function LibraryDialog() {
  const studio = useStudio();
  const open = studio.libraryOpen;
  const [packs, setPacks] = useState<AssetPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AssetCategory | "all">("all");
  const [theme, setTheme] = useState<string | "all">("all");
  const [tag, setTag] = useState<string | "all">("all");
  const [selectedId, setSelectedId] = useState("hero");
  const [pending, setPending] = useState<Pending | null>(null);
  const [mainPreview, setMainPreview] = useState<{ copy: LibraryAssetCopy; source: string; choice: LibraryChoice } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [localFiles, setLocalFiles] = useState<Record<string, Uint8Array>>({});
  const [removeKept, setRemoveKept] = useState(false);
  const [keptUrl, setKeptUrl] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const moreRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoading(true);
    setError("");
    void Promise.all([loadLibrary(), loadKeptPack()])
      .then(([loaded, kept]) => {
        if (cancel) return;
        setPacks(kept ? [...loaded, kept.pack] : loaded);
        setLocalFiles(kept?.files ?? {});
        setLoading(false);
      })
      .catch(() => {
        if (cancel) return;
        setError(text.library.failed);
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [open, reload, studio.soundLibraryVersion]);

  useEffect(() => {
    if (open) return;
    setPending(null);
    setMainPreview(null);
    setStatus("");
    setCopied(false);
    setPlaying(false);
    playerRef.current?.pause();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (mainPreview || pending) {
        setMainPreview(null);
        setPending(null);
        return;
      }
      studio.setLibraryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mainPreview, pending, studio]);

  const rows = useMemo(() => packs.flatMap((pack) => pack.assets.map((asset) => ({ pack, asset }))), [packs]);
  const groups = libraryFilterGroups(
    rows.map((row) => row.asset),
    text.library.categories,
  );
  const pinnedTag = !tagsOpen && tag !== "all" && groups.moreTags.includes(tag) ? [tag] : [];
  const visibleTags = tagsOpen ? [...groups.tags, ...groups.moreTags] : [...groups.tags, ...pinnedTag];
  const shown = filterAssets(
    rows.map((row) => row.asset),
    { text: query, category, theme, tag },
  );
  const visible = rows.filter((row) => shown.includes(row.asset));
  const selected = visible.find((row) => row.asset.id === selectedId) ?? visible[0] ?? null;
  const keptPath = selected?.pack.id === KEPT_PACK_ID && selected.asset.mediaType.startsWith("audio/") ? selected.asset.path : "";
  useEffect(() => {
    if (!keptPath) return;
    const bytes = localFiles[keptPath];
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/wav" }));
    setKeptUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [keptPath, localFiles]);

  if (!open) return null;

  const finish = async (copy: LibraryAssetCopy, choice: LibraryChoice, example: LibraryExample, intent: OpenIntent = "copy") => {
    setBusy(true);
    try {
      const animation = intent === "sprite" && choice !== "keep" ? selected?.asset.animation : undefined;
      const outcome = animation
        ? await studio.openLibrarySprite(copy, animation, choice)
        : await studio.copyLibraryAsset({ copy, choice, example });
      setStatus(text.library.message(outcome));
      if (outcome.ok) {
        setPending(null);
        setMainPreview(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const prepare = async (row: Row): Promise<Prepared | null> => {
    const bytes =
      row.pack.id === KEPT_PACK_ID ? localFiles[row.asset.path] : await loadAssetBytes(row.pack.id, row.asset.path);
    if (!bytes) throw new Error("Missing sound");
    const copy = libraryCopyFrom(row.pack, row.asset, bytes);
    if (!studio.project) {
      setStatus(text.library.message({ code: "no-project", path: "", pinsSkipped: false, exampleSkipped: false }));
      return null;
    }
    const plan = await describeLibraryCopy(studio.project, copy);
    return { copy, plan };
  };

  const onAdd = async () => {
    if (!selected) return;
    setBusy(true);
    setCopied(false);
    try {
      const next = await prepare(selected);
      if (!next) return;
      if (next.plan.kind === "conflict" || next.plan.kind === "update") {
        setPending({ ...next, intent: "copy" });
        setMainPreview(null);
        setStatus("");
        return;
      }
      await finish(next.copy, "add", "none");
    } catch {
      setError(text.library.failed);
    } finally {
      setBusy(false);
    }
  };

  const onTry = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const next = await prepare(selected);
      if (!next) return;
      if (next.plan.kind === "conflict" || next.plan.kind === "update") {
        setPending({ ...next, intent: "copy" });
        setMainPreview(null);
        return;
      }
      setPending(null);
      setMainPreview({
        copy: next.copy,
        source: pygameDemoMain(next.copy, next.plan.path),
        choice: next.plan.kind === "identical" ? "keep" : "add",
      });
    } catch {
      setError(text.library.failed);
    } finally {
      setBusy(false);
    }
  };

  const onSaveExample = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const next = await prepare(selected);
      if (!next) return;
      if (next.plan.kind === "conflict" || next.plan.kind === "update") {
        setPending({ ...next, intent: "copy" });
        return;
      }
      await finish(next.copy, next.plan.kind === "identical" ? "keep" : "add", "file");
    } catch {
      setError(text.library.failed);
    } finally {
      setBusy(false);
    }
  };

  const onOpenSprite = async () => {
    if (!selected?.asset.animation) return;
    setBusy(true);
    try {
      const next = await prepare(selected);
      if (!next) return;
      if (next.plan.kind === "conflict" || next.plan.kind === "update") {
        setPending({ ...next, intent: "sprite" });
        setMainPreview(null);
        setStatus("");
        return;
      }
      await finish(next.copy, "add", "none", "sprite");
    } catch {
      setError(text.library.failed);
    } finally {
      setBusy(false);
    }
  };

  const dest = selected ? libraryDest({ packId: selected.pack.id, assetPath: selected.asset.path }) : "";
  const snippet = selected ? pygameSnippet(snippetOf(selected.asset), dest) : "";
  const relatedRows = selected
    ? relatedAssets(rows.map((row) => row.asset), selected.asset)
        .slice(0, 8)
        .flatMap((asset) => {
          const row = rows.find((item) => item.asset === asset);
          return row ? [row] : [];
        })
    : [];
  const audioPreview =
    selected && selected.asset.mediaType.startsWith("audio/")
      ? selected.pack.id === KEPT_PACK_ID
        ? keptUrl
        : packAssetUrl(selected.pack.id, selected.asset.path)
      : "";
  const actions = selected ? detailActions(selected.asset) : null;
  const creditView = selected ? attributionView(selected.asset.attribution) : null;
  const displayName = selected ? assetDisplayName(selected.asset) || selected.asset.id : "";

  const copySnippet = () => {
    void navigator.clipboard.writeText(snippet).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  const playSelected = () => {
    const el = playerRef.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => {});
  };

  const onAction = (id: SecondaryAction) => {
    if (moreRef.current) moreRef.current.open = false;
    if (!selected) return;
    if (id === "hear") {
      playSelected();
      return;
    }
    if (id === "openSprite") {
      void onOpenSprite();
      return;
    }
    if (id === "try") {
      void onTry();
      return;
    }
    if (id === "saveExample") {
      void onSaveExample();
      return;
    }
    if (id === "copyCode") {
      copySnippet();
      return;
    }
    void studio.proposeCatalogAsset(selected.pack.id, selected.asset.id);
  };

  const actionLabel = (id: SecondaryAction): { label: string; hint?: string } => {
    if (id === "hear") return { label: text.library.hear };
    if (id === "openSprite") return { label: text.library.openSprite, hint: text.library.openSpriteHint };
    if (id === "try") return { label: text.library.try, hint: text.library.tryHint };
    if (id === "saveExample") return { label: text.library.saveExample, hint: text.library.saveExampleHint };
    if (id === "copyCode") return { label: text.library.copyCode, hint: text.library.copyCodeHint };
    return { label: text.library.propose, hint: text.library.proposeHint };
  };

  const actionTestId = (id: SecondaryAction, place: "bar" | "menu"): string | undefined => {
    if (place === "menu" && (actions?.shortcuts.includes(id) || id === "copyCode")) return undefined;
    if (id === "hear") return "library-hear";
    if (id === "openSprite") return "library-open-sprite";
    if (id === "try") return "library-try";
    if (id === "saveExample") return "library-save-example";
    if (id === "copyCode") return "library-copy-code";
    return "library-propose";
  };

  const renderAction = (id: SecondaryAction, place: "bar" | "menu") => {
    const { label, hint } = actionLabel(id);
    const disabled = busy || (id === "hear" && !audioPreview);
    if (place === "bar") {
      return (
        <button key={id} type="button" disabled={disabled} data-testid={actionTestId(id, place)} aria-label={label} onClick={() => onAction(id)}>
          {label}
        </button>
      );
    }
    return (
      <button key={id} type="button" disabled={disabled} data-testid={actionTestId(id, place)} aria-label={label} onClick={() => onAction(id)}>
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </button>
    );
  };

  return (
    <div className="modal-back" role="presentation">
      <section className="modal library" role="dialog" aria-modal="true" aria-labelledby="library-title" data-testid="library-dialog">
        <header className="projects-head">
          <h2 id="library-title">{text.library.title}</h2>
          <input
            className="projects-search"
            type="search"
            value={query}
            placeholder={text.library.search}
            aria-label={text.library.search}
            data-testid="library-search"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" onClick={() => studio.setLibraryOpen(false)}>
            {text.library.close}
          </button>
        </header>
        <p>{text.library.copy}</p>
        <div className="library-filters">
          <div className="library-filter-row" role="group" aria-label={text.library.groups.category} data-testid="library-filter-category">
            <span className="library-filter-label">{text.library.groups.category}</span>
            <button
              type="button"
              className={category === "all" && theme === "all" && tag === "all" ? "on" : ""}
              data-testid="library-filter-all"
              onClick={() => {
                setCategory("all");
                setTheme("all");
                setTag("all");
              }}
            >
              {text.library.all}
            </button>
            {groups.categories.map((item) => (
              <button
                key={item.id}
                type="button"
                className={category === item.id ? "on" : ""}
                data-testid={`library-category-${item.id}`}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {groups.themes.length ? (
            <div className="library-filter-row" role="group" aria-label={text.library.groups.theme} data-testid="library-filter-theme">
              <span className="library-filter-label">{text.library.groups.theme}</span>
              {groups.themes.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={theme === item ? "on" : ""}
                  data-testid={`library-theme-${item}`}
                  onClick={() => setTheme(theme === item ? "all" : item)}
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
          {groups.tags.length || groups.moreTags.length ? (
            <div className="library-filter-row" role="group" aria-label={text.library.groups.tag} data-testid="library-filter-tag">
              <span className="library-filter-label">{text.library.groups.tag}</span>
              {visibleTags.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={tag === item ? "on" : ""}
                  data-testid={`library-tag-${item}`}
                  onClick={() => setTag(tag === item ? "all" : item)}
                >
                  {item}
                </button>
              ))}
              {groups.moreTags.length ? (
                <button type="button" data-testid="library-filters-more" onClick={() => setTagsOpen((open) => !open)}>
                  {tagsOpen ? text.library.less : text.library.more}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {loading ? <p>{text.library.loading}</p> : null}
        {error ? (
          <p>
            {error}{" "}
            <button
              type="button"
              onClick={() => {
                clearCatalogCache();
                setReload((count) => count + 1);
              }}
            >
              {text.library.retry}
            </button>
          </p>
        ) : null}
        <div className="library-body">
          <div className="library-grid">
            {visible.map((row) => {
              const name = assetDisplayName(row.asset) || row.asset.id;
              const audio = row.asset.mediaType.startsWith("audio/");
              const same = selected?.asset.id === row.asset.id;
              return (
                <button
                  key={`${row.pack.id}/${row.asset.id}`}
                  type="button"
                  className={["library-card", same ? "on" : "", audio && same && playing ? "is-playing" : ""].filter(Boolean).join(" ")}
                  data-testid={`library-asset-${row.asset.id}`}
                  aria-label={audio ? `${name}，${row.pack.title}` : name}
                  onClick={() => {
                    // Commit the new <audio src> before play(), so the click is still a user gesture.
                    flushSync(() => {
                      setSelectedId(row.asset.id);
                      setPending(null);
                      setMainPreview(null);
                      setCopied(false);
                    });
                    const el = playerRef.current;
                    if (!audio || !el) return;
                    el.currentTime = 0;
                    void el.play().catch(() => {});
                  }}
                >
                  <span className="library-card-body">
                    {audio ? (
                      <>
                        <span className="library-audio" aria-hidden="true">
                          <SoundGlyph mark={soundMark(row.asset.tags)} />
                        </span>
                        <span className="library-pack">{row.pack.title}</span>
                      </>
                    ) : (
                      <img src={packAssetUrl(row.pack.id, row.asset.preview)} alt="" width={64} height={64} loading="lazy" decoding="async" />
                    )}
                    <span className="library-name" data-testid={`library-asset-name-${row.asset.id}`}>
                      {name}
                    </span>
                  </span>
                </button>
              );
            })}
            {!loading && !visible.length ? <p className="library-empty">{text.library.empty}</p> : null}
          </div>
          {selected && actions && creditView ? (
            <div className="library-detail" data-testid="library-detail">
              <div className="library-detail-scroll" data-testid="library-detail-scroll">
                <div className="library-hero">
                  {selected.asset.mediaType.startsWith("audio/") ? (
                    <LibraryPlayer
                      sourceUrl={audioPreview}
                      fallbackUrl={
                        selected.asset.mediaType === "audio/ogg"
                          ? packAssetUrl(selected.pack.id, oggPreviewWavPath(selected.asset.path) ?? selected.asset.path)
                          : null
                      }
                      mediaType={selected.asset.mediaType}
                      playerRef={playerRef}
                      onPlayState={setPlaying}
                    />
                  ) : selected.asset.animation ? (
                    <SpriteStage asset={selected.asset} src={packAssetUrl(selected.pack.id, selected.asset.preview)} />
                  ) : (
                    <img className="preview" src={packAssetUrl(selected.pack.id, selected.asset.preview)} alt={displayName} data-testid="library-preview" />
                  )}
                  <h3>{displayName}</h3>
                  <p className="library-intro" data-testid="library-intro">
                    {introOf(selected.asset)}
                  </p>
                  {selected.asset.tags.includes("变体") ? <p data-testid="library-variant">{text.library.variant}</p> : null}
                </div>
                {relatedRows.length ? (
                  <div className="library-related-block" data-testid="library-related">
                    <p>{text.library.related}</p>
                    <div className="library-related-row">
                      {relatedRows.map((row) => {
                        const label = assetDisplayName(row.asset) || row.asset.id;
                        const audio = row.asset.mediaType.startsWith("audio/");
                        return (
                          <button
                            key={`${row.pack.id}/${row.asset.id}`}
                            type="button"
                            aria-label={label}
                            title={label}
                            onClick={() => {
                              setSelectedId(row.asset.id);
                              setCategory("all");
                              setTag("all");
                              setTheme("all");
                              setQuery("");
                            }}
                          >
                            {audio ? (
                              <span className="library-audio" aria-hidden="true">
                                <SoundGlyph mark={soundMark(row.asset.tags)} />
                              </span>
                            ) : (
                              <img src={packAssetUrl(row.pack.id, row.asset.preview)} alt="" width={40} height={40} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <details className="library-fold" data-testid="library-code" key={`code-${selected.asset.id}`}>
                  <summary>{text.library.codeFold}</summary>
                  <p data-testid="library-dest">{text.library.dest(dest)}</p>
                  <pre className="library-snippet" data-testid="library-snippet">
                    {snippet}
                  </pre>
                  <div className="library-code-bar">
                    <button type="button" data-testid="library-copy-code" onClick={copySnippet}>
                      {copied ? text.library.copied : text.library.copyCode}
                    </button>
                  </div>
                </details>
                <details className="library-fold" data-testid="library-adult" key={`adult-${selected.asset.id}`}>
                  <summary>{text.library.adult}</summary>
                  <p data-testid="library-license">
                    {text.library.license}：{selected.asset.license.name}（{selected.asset.license.spdx}）
                  </p>
                  <p data-testid="library-author">
                    {text.library.author}：{selected.asset.author}
                  </p>
                  <p data-testid="library-source">
                    {text.library.source}：
                    <a href={selected.asset.source} target="_blank" rel="noreferrer">
                      {selected.asset.source}
                    </a>
                  </p>
                  <p data-testid="library-attribution">
                    {text.library.attribution}：{creditView.credit || selected.asset.attribution}
                  </p>
                  <p>
                    {text.library.theme}：{selected.asset.theme} · {text.library.categories[selected.asset.category]} · {text.library.version}{" "}
                    {selected.asset.version}
                  </p>
                  <p data-testid="library-tags">
                    {text.library.tags}：{selected.asset.tags.join("、")}
                  </p>
                  <p data-testid="library-size">
                    {selected.asset.width && selected.asset.height ? text.library.size(selected.asset.width, selected.asset.height) : ""}
                    {selected.asset.mediaType.startsWith("audio/") ? text.library.audio : ""}
                    {selected.asset.animation ? ` · ${text.library.frames(selected.asset.animation.frames.length)}` : ""}
                  </p>
                  {selected.asset.animation?.states ? <p>{text.library.states(Object.keys(selected.asset.animation.states).join("、"))}</p> : null}
                  {selected.asset.collision ? <p>{text.library.collision(selected.asset.collision.width, selected.asset.collision.height)}</p> : null}
                  {creditView.technical ? (
                    <p className="library-technical" data-testid="library-technical">
                      {text.library.technical}：{creditView.technical}
                    </p>
                  ) : null}
                </details>
                {selected.pack.id === KEPT_PACK_ID ? (
                  removeKept ? (
                    <div className="library-choice">
                      <p>{text.library.confirmRemoveKept}</p>
                      <button
                        type="button"
                        data-testid="library-remove-kept-confirm"
                        onClick={() => {
                          void studio.forgetKeptSound(selected.asset.id).then(() => {
                            setRemoveKept(false);
                            setStatus(text.library.removedKept);
                          });
                        }}
                      >
                        {text.library.removeKept}
                      </button>
                    </div>
                  ) : (
                    <button type="button" data-testid="library-remove-kept" onClick={() => setRemoveKept(true)}>
                      {text.library.removeKept}
                    </button>
                  )
                ) : null}
                {pending ? (
                  <div className="library-choice" data-testid="library-conflict">
                    <p>
                      {pending.plan.kind === "update"
                        ? text.library.update(pending.plan.fromVersion, pending.plan.toVersion)
                        : pending.plan.kind === "conflict" && pending.plan.reason === "edited"
                          ? text.library.conflictEdited
                          : pending.plan.kind === "conflict" && pending.plan.reason === "different"
                            ? text.library.conflictDifferent
                            : text.library.conflictName}
                    </p>
                    <div className="modal-actions">
                      <button type="button" disabled={busy} onClick={() => void finish(pending.copy, "keep", "none", pending.intent)}>
                        {text.library.keep}
                      </button>
                      <button type="button" disabled={busy} onClick={() => void finish(pending.copy, "save-as", "none", pending.intent)}>
                        {text.library.saveAs}
                      </button>
                      <button type="button" className="run" disabled={busy} data-testid="library-replace" onClick={() => void finish(pending.copy, "replace", "none", pending.intent)}>
                        {text.library.replace}
                      </button>
                    </div>
                  </div>
                ) : null}
                {mainPreview ? (
                  <div data-testid="library-main-confirm">
                    <p>{text.library.mainPreview}</p>
                    <pre className="library-snippet" data-testid="library-main-preview">
                      {mainPreview.source}
                    </pre>
                  </div>
                ) : null}
              </div>
              {mainPreview ? (
                <div className="library-actions" data-testid="library-actions">
                  <button type="button" onClick={() => setMainPreview(null)}>
                    {text.library.cancel}
                  </button>
                  <button type="button" className="run" data-testid="library-confirm-main" disabled={busy} onClick={() => void finish(mainPreview.copy, mainPreview.choice, "main")}>
                    {text.library.confirmMain}
                  </button>
                </div>
              ) : (
                <div className="library-actions" data-testid="library-actions">
                  <button type="button" className="run" disabled={busy} data-testid="library-add" title={text.library.addHint} onClick={() => void onAdd()}>
                    {text.library.add}
                  </button>
                  {actions.shortcuts.map((id) => renderAction(id, "bar"))}
                  <details className="library-more" data-testid="library-more" key={selected.asset.id} ref={moreRef}>
                    <summary>{text.library.moreActions}</summary>
                    <div className="library-more-menu" data-testid="library-more-menu">
                      {actions.more.map((id) => renderAction(id, "menu"))}
                    </div>
                  </details>
                </div>
              )}
            </div>
          ) : null}
          {status ? <p data-testid="library-status">{status}</p> : null}
        </div>
      </section>
    </div>
  );
}

function introOf(asset: CatalogAsset): string {
  const spec = assetIntroSpec(asset);
  if (spec.kind === "states") return text.library.intro.states(spec.states);
  if (spec.kind === "moving") return text.library.intro.moving;
  return text.library.intro[spec.kind];
}

function SpriteStage({ asset, src }: { asset: CatalogAsset; src: string }) {
  const animation = asset.animation;
  const [at, setAt] = useState(0);
  useEffect(() => {
    setAt(0);
    if (!animation || animation.frames.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frames = animation.frames;
    let index = 0;
    let timer = 0;
    let alive = true;
    const tick = () => {
      const wait = frames[index]?.durationMs ?? 200;
      timer = window.setTimeout(() => {
        if (!alive) return;
        index = (index + 1) % frames.length;
        setAt(index);
        tick();
      }, wait);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [asset.id, animation]);

  if (!animation || !asset.width || !asset.height) return null;
  const frame = animation.frames[at] ?? animation.frames[0];
  const { col, row } = frameOrigin(asset.width, animation.frameWidth, frame.index);
  const scale = previewScale(Math.max(animation.frameWidth, animation.frameHeight));
  const style = {
    width: animation.frameWidth * scale,
    height: animation.frameHeight * scale,
    "--sheet": `url("${src}")`,
    "--pos": `-${col * animation.frameWidth * scale}px -${row * animation.frameHeight * scale}px`,
    "--sheet-size": `${asset.width * scale}px ${asset.height * scale}px`,
  } as CSSProperties;
  return <div className="library-stage" data-testid="library-preview" role="img" aria-label={assetDisplayName(asset)} style={style} />;
}

function SoundGlyph({ mark }: { mark: SoundMark }) {
  const common = { viewBox: "0 0 28 28", "aria-hidden": true as const };
  switch (mark) {
    case "jump":
      return (
        <svg {...common}>
          <path d="M4 22c5-14 15-14 20 0" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="20" cy="8" r="2" fill="currentColor" />
        </svg>
      );
    case "coin":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M14 9v10M11 12h5a2 2 0 0 1 0 4h-4" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "laser":
      return (
        <svg {...common}>
          <path d="M4 20 L22 6" stroke="currentColor" strokeWidth="2" />
          <path d="M16 6h6v6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "boom":
      return (
        <svg {...common}>
          <path d="M14 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "click":
      return (
        <svg {...common}>
          <rect x="6" y="8" width="16" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M11 14h6" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "step":
      return (
        <svg {...common}>
          <path d="M8 20c2-6 4-8 6-8s4 2 6 8" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="14" cy="8" r="2" fill="currentColor" />
        </svg>
      );
    case "door":
      return (
        <svg {...common}>
          <path d="M8 6h10v16H8z" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="15" cy="14" r="1" fill="currentColor" />
        </svg>
      );
    case "hit":
      return (
        <svg {...common}>
          <path d="M6 16l6-8 4 5 6-7" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "music":
      return (
        <svg {...common}>
          <path d="M10 20V8l10-2v12" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="8" cy="20" r="2" fill="currentColor" />
          <circle cx="18" cy="18" r="2" fill="currentColor" />
        </svg>
      );
    case "power":
      return (
        <svg {...common}>
          <path d="M14 5v8" stroke="currentColor" strokeWidth="2" />
          <path d="M9 9a6 6 0 1 0 10 0" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M6 14h2l2-5 3 10 2-5h3" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
  }
}
