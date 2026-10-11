import { useEffect, useMemo, useState } from "react";
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
import { filterAssets, relatedAssets } from "../lib/assets/filter";
import type { AssetCategory, AssetPack, CatalogAsset } from "../lib/assets/schema";
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
  const themes = [...new Set(rows.map((row) => row.asset.theme))];
  const categories = [...new Set(rows.map((row) => row.asset.category))];
  const tags = [...new Set(rows.flatMap((row) => row.asset.tags))];
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
  const related = selected ? relatedAssets(rows.map((row) => row.asset), selected.asset).slice(0, 8) : [];
  const audioPreview =
    selected && selected.asset.mediaType.startsWith("audio/")
      ? selected.pack.id === KEPT_PACK_ID
        ? ""
        : packAssetUrl(selected.pack.id, selected.asset.path)
      : "";

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
          <button
            type="button"
            className={category === "all" && theme === "all" && tag === "all" ? "on" : ""}
            onClick={() => {
              setCategory("all");
              setTheme("all");
              setTag("all");
            }}
          >
            {text.library.all}
          </button>
          {categories.map((item) => (
            <button key={item} type="button" className={category === item ? "on" : ""} data-testid={`library-category-${item}`} onClick={() => setCategory(item)}>
              {text.library.categories[item]}
            </button>
          ))}
          {themes.map((item) => (
            <button key={item} type="button" className={theme === item ? "on" : ""} onClick={() => setTheme(theme === item ? "all" : item)}>
              {item}
            </button>
          ))}
          {tags.map((item) => (
            <button key={item} type="button" className={tag === item ? "on" : ""} onClick={() => setTag(tag === item ? "all" : item)}>
              {item}
            </button>
          ))}
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
            {visible.map((row) => (
              <button
                key={`${row.pack.id}/${row.asset.id}`}
                type="button"
                className={selected?.asset.id === row.asset.id ? "library-card on" : "library-card"}
                data-testid={`library-asset-${row.asset.id}`}
                onClick={() => {
                  setSelectedId(row.asset.id);
                  setPending(null);
                  setMainPreview(null);
                  setCopied(false);
                }}
              >
                {row.asset.mediaType.startsWith("audio/") ? (
                  <span className="library-audio">{text.library.audio}</span>
                ) : (
                  <img src={packAssetUrl(row.pack.id, row.asset.preview)} alt="" width={64} height={64} loading="lazy" decoding="async" />
                )}
                <span>{row.asset.title}</span>
              </button>
            ))}
            {!loading && !visible.length ? <p className="library-empty">{text.library.empty}</p> : null}
          </div>
          {selected ? (
            <div className="library-detail" data-testid="library-detail">
              {selected.asset.mediaType.startsWith("audio/") ? (
                <audio controls src={selected.pack.id === KEPT_PACK_ID ? keptUrl : audioPreview} data-testid="library-preview" />
              ) : (
                <img className="preview" src={packAssetUrl(selected.pack.id, selected.asset.preview)} alt={selected.asset.title} data-testid="library-preview" />
              )}
              <h3>{selected.asset.title}</h3>
              <p data-testid="library-size">
                {selected.asset.width && selected.asset.height ? text.library.size(selected.asset.width, selected.asset.height) : ""}
                {selected.asset.mediaType.startsWith("audio/") ? text.library.audio : ""}
                {selected.asset.animation ? ` · ${text.library.frames(selected.asset.animation.frames.length)}` : ""}
              </p>
              <p>
                {text.library.theme}：{selected.asset.theme} · {text.library.categories[selected.asset.category]} · {text.library.version} {selected.asset.version}
              </p>
              <p data-testid="library-tags">
                {text.library.tags}：{selected.asset.tags.join("、")}
              </p>
              {selected.asset.tags.includes("变体") ? <p data-testid="library-variant">{text.library.variant}</p> : null}
              {related.length ? (
                <p data-testid="library-related">
                  {text.library.related}：
                  {related.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(asset.id);
                        setCategory("all");
                        setTag("all");
                        setTheme("all");
                        setQuery("");
                      }}
                    >
                      {asset.title}
                    </button>
                  ))}
                </p>
              ) : null}
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
              {selected.asset.animation?.states ? <p>{text.library.states(Object.keys(selected.asset.animation.states).join("、"))}</p> : null}
              {selected.asset.collision ? (
                <p>{text.library.collision(selected.asset.collision.width, selected.asset.collision.height)}</p>
              ) : null}
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
                {text.library.attribution}：{selected.asset.attribution}
              </p>
              <p data-testid="library-dest">{text.library.dest(dest)}</p>
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
                  <div className="modal-actions">
                    <button type="button" onClick={() => setMainPreview(null)}>
                      {text.library.cancel}
                    </button>
                    <button
                      type="button"
                      className="run"
                      data-testid="library-confirm-main"
                      disabled={busy}
                      onClick={() => void finish(mainPreview.copy, mainPreview.choice, "main")}
                    >
                      {text.library.confirmMain}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p>{text.library.snippet}</p>
                  <pre className="library-snippet" data-testid="library-snippet">
                    {snippet}
                  </pre>
                  <div className="modal-actions">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(snippet).then(
                          () => setCopied(true),
                          () => setCopied(false),
                        );
                      }}
                    >
                      {copied ? text.library.copied : text.library.copyCode}
                    </button>
                    <button type="button" disabled={busy || !selected} onClick={() => void onSaveExample()}>
                      {text.library.saveExample}
                    </button>
                    <button type="button" disabled={busy || !selected} data-testid="library-try" onClick={() => void onTry()}>
                      {text.library.try}
                    </button>
                    <button type="button" className="run" disabled={busy || !selected} data-testid="library-add" onClick={() => void onAdd()}>
                      {text.library.add}
                    </button>
                    {selected.asset.animation ? (
                      <button type="button" disabled={busy} data-testid="library-open-sprite" onClick={() => void onOpenSprite()}>
                        {text.library.openSprite}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy || !selected}
                      data-testid="library-propose"
                      onClick={() => {
                        if (!selected) return;
                        void studio.proposeCatalogAsset(selected.pack.id, selected.asset.id);
                      }}
                    >
                      {text.library.propose}
                    </button>
                  </div>
                  <p className="quiet">{text.library.tryHint}</p>
                </>
              )}
            </div>
          ) : null}
          {status ? <p data-testid="library-status">{status}</p> : null}
        </div>
      </section>
    </div>
  );
}
