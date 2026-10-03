import { useEffect, useState } from "react";
import { assetFilter, fileTree, mediaType, normalizePath, type TrashedFile, type TreeNode } from "../lib/project";
import { useStudio } from "../studio/store";
import { text } from "./text";

/**
 * 看代码 的左侧：文件与素材。
 *
 * One thing happens at a time: either a row is being renamed, or a new file is
 * being typed, or a row is asking to confirm a delete — never two at once, and
 * Escape or 取消 closes whichever one is open.
 * Deleting always goes through the trash, so nothing is one click from gone.
 */
export function Sidebar() {
  const studio = useStudio();
  const [pane, setPane] = useState<"files" | "assets">("files");
  /** `{ kind: "new" }` for a new file, `{ kind: "rename", path }` for a row. */
  const [editing, setEditing] = useState<{ kind: "new" | "rename"; path: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const project = studio.project;
  if (!project) return <aside className="sidebar" />;

  const tree = fileTree(project.files.map((file) => file.path));
  const assets = project.files.filter((file) => assetFilter(file.path));
  const trash = project.trash ?? [];
  const draftPath = normalizePath(draft);
  const renameTarget = editing?.kind === "rename" ? editing.path : null;
  const taken = !!draftPath && draftPath !== renameTarget && project.files.some((file) => file.path === draftPath);

  const startNew = () => {
    setConfirming(null);
    setPane("files");
    setEditing({ kind: "new", path: "" });
    setDraft("");
  };

  const startRename = (path: string) => {
    setConfirming(null);
    setEditing({ kind: "rename", path });
    setDraft(path);
  };

  const cancel = () => {
    setEditing(null);
    setDraft("");
  };

  /** Closes whichever row is asking a question (composer or delete confirm). */
  const cancelConfirm = () => setConfirming(null);

  /** Escape closes the row that is asking, wherever focus happens to be. */
  useEffect(() => {
    if (!editing && !confirming) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setEditing(null);
      setDraft("");
      setConfirming(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, confirming]);

  const submit = () => {
    if (!editing) return;
    if (editing.kind === "new") {
      if (studio.createFile(draft)) cancel();
      return;
    }
    // Submitting the same name is not an error; it just means "no change".
    if (!draftPath || draftPath === editing.path) cancel();
    else if (studio.renameCurrent(editing.path, draft)) cancel();
  };

  return (
    <aside className="sidebar">
      <div className="seg">
        <button type="button" className={pane === "files" ? "on" : ""} onClick={() => setPane("files")}>
          {text.code.files}
        </button>
        <button type="button" className={pane === "assets" ? "on" : ""} onClick={() => setPane("assets")}>
          {text.code.assets}
        </button>
      </div>

      {pane === "files" ? (
        <>
          <div className="side-tools">
            <span className="side-count">{text.code.fileCount(project.files.length)}</span>
            <button type="button" data-testid="new-file" onClick={startNew} disabled={editing?.kind === "new"}>
              <IconPlus />
              {text.code.newFile}
            </button>
          </div>

          {editing?.kind === "new" ? (
            <FileComposer
              label={text.code.newFileHint}
              value={draft}
              placeholder="game/enemy.py"
              confirm={text.code.create}
              disabled={!draftPath || taken}
              hint={taken ? text.code.pathTaken : ""}
              onChange={setDraft}
              onSubmit={submit}
              onCancel={cancel}
            />
          ) : null}

          <div className="tree">
            {tree.map((node) => (
              <Node
                key={node.path}
                node={node}
                depth={0}
                active={studio.path}
                editing={editing?.kind === "rename" ? editing.path : null}
                draft={draft}
                taken={taken}
                confirming={confirming}
                onOpen={studio.setPath}
                onStartRename={startRename}
                onChangeDraft={setDraft}
                onSubmitRename={submit}
                onCancel={cancel}
                onAskDelete={setConfirming}
                onConfirmDelete={(path) => {
                  studio.trashFile(path);
                  setConfirming(null);
                }}
                onCancelConfirm={cancelConfirm}
              />
            ))}
            {!project.files.length ? <p className="empty">{text.code.noFiles}</p> : null}
          </div>

          <section className={trashOpen ? "trash open" : "trash"} data-testid="trash">
            <button type="button" className="trash-head" onClick={() => setTrashOpen(!trashOpen)}>
              <span>
                {text.code.trash}
                {trash.length ? <b>{trash.length}</b> : null}
              </span>
              <small>{trashOpen ? text.code.trashHide : text.code.trashShow}</small>
            </button>
            {trashOpen ? (
              <div className="trash-list">
                {trash.map((entry) => (
                  <TrashRow
                    key={entry.file.path}
                    entry={entry}
                    confirming={confirming === entry.file.path}
                    onRestore={() => studio.restoreFromTrash(entry.file.path)}
                    onAskDelete={setConfirming}
                    onConfirmDelete={() => {
                      studio.dropFromTrash(entry.file.path);
                      setConfirming(null);
                    }}
                    onCancelConfirm={() => setConfirming(null)}
                  />
                ))}
                {!trash.length ? <p className="empty">{text.code.trashEmpty}</p> : null}
                {trash.length ? (
                  <button className="trash-empty" type="button" onClick={studio.emptyTrash}>
                    {text.code.trashEmptyAll}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <>
          <div className="side-tools">
            <span className="side-count">{text.code.assetCount(assets.length)}</span>
            <label className="file-btn" title={text.code.uploadHint}>
              <IconUpload />
              {text.code.upload}
              <input
                type="file"
                multiple
                onChange={(event) => {
                  const list = [...(event.target.files ?? [])];
                  for (const file of list) {
                    void file.arrayBuffer().then((buffer) => studio.addBytes(`assets/${file.name}`, new Uint8Array(buffer)));
                  }
                  event.target.value = "";
                }}
              />
            </label>
            <button type="button" title={text.code.generateHint} onClick={() => studio.setAssetOpen(true)}>
              <IconSparkle />
              {text.code.generate}
            </button>
            <button type="button" data-testid="sound-open" title={text.sounds.title} onClick={() => studio.setSoundOpen(true)}>
              <IconNote />
              {text.sounds.entry}
            </button>
          </div>
          <div className="asset-grid">
            {assets.map((file) => (
              <button
                key={file.path}
                type="button"
                aria-label={file.path}
                className={file.path === studio.path ? "card on" : "card"}
                onClick={() => studio.setPath(file.path)}
              >
                <AssetThumb path={file.path} bytes={file.bytes} />
                <span>{file.path.split("/").pop()}</span>
              </button>
            ))}
            {!assets.length ? <p className="empty">{text.code.noAssets}</p> : null}
          </div>
        </>
      )}
    </aside>
  );
}

/** The one editable row in the sidebar: new file, or renaming an existing one. */
function FileComposer({
  label,
  value,
  placeholder,
  confirm,
  disabled,
  hint,
  onChange,
  onSubmit,
  onCancel,
}: {
  label: string;
  value: string;
  placeholder: string;
  confirm: string;
  disabled: boolean;
  hint: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="composer"
      data-testid="composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label>
        <span>{label}</span>
        <input
          value={value}
          placeholder={placeholder}
          autoFocus
          onFocus={(event) => event.target.select()}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="composer-actions">
        <button className="primary" type="submit" disabled={disabled}>
          {confirm}
        </button>
        <button type="button" onClick={onCancel}>
          {text.code.cancel}
        </button>
      </div>
      {hint ? <p className="composer-hint">{hint}</p> : null}
    </form>
  );
}

function Node({
  node,
  depth,
  active,
  editing,
  draft,
  taken,
  confirming,
  onOpen,
  onStartRename,
  onChangeDraft,
  onSubmitRename,
  onCancel,
  onAskDelete,
  onConfirmDelete,
  onCancelConfirm,
}: {
  node: TreeNode;
  depth: number;
  active: string;
  editing: string | null;
  draft: string;
  taken: boolean;
  confirming: string | null;
  onOpen: (path: string) => void;
  onStartRename: (path: string) => void;
  onChangeDraft: (value: string) => void;
  onSubmitRename: () => void;
  onCancel: () => void;
  onAskDelete: (path: string) => void;
  onConfirmDelete: (path: string) => void;
  onCancelConfirm: () => void;
}) {
  if (!node.file) {
    return (
      <div>
        <div className="dir" style={{ paddingLeft: 8 + depth * 12 }}>
          {node.name}
        </div>
        {node.children.map((child) => (
          <Node
            key={child.path}
            node={child}
            depth={depth + 1}
            active={active}
            editing={editing}
            draft={draft}
            taken={taken}
            confirming={confirming}
            onOpen={onOpen}
            onStartRename={onStartRename}
            onChangeDraft={onChangeDraft}
            onSubmitRename={onSubmitRename}
            onCancel={onCancel}
            onAskDelete={onAskDelete}
            onConfirmDelete={onConfirmDelete}
            onCancelConfirm={onCancelConfirm}
          />
        ))}
      </div>
    );
  }

  const pad = 8 + depth * 12;
  if (editing === node.path) {
    return (
      <div style={{ paddingLeft: pad }} className="row-editing">
        <FileComposer
          label={text.code.renameHint}
          value={draft}
          placeholder="main.py"
          confirm={text.code.rename}
          disabled={taken}
          hint={taken ? text.code.pathTaken : ""}
          onChange={onChangeDraft}
          onSubmit={onSubmitRename}
          onCancel={onCancel}
        />
      </div>
    );
  }

  if (confirming === node.path) {
    return (
      <div className="row row-confirm" style={{ paddingLeft: pad }} data-testid="delete-confirm">
        <span>{text.code.confirmTrash(node.name)}</span>
        <button type="button" className="danger" onClick={() => onConfirmDelete(node.path)}>
          {text.code.trashConfirm}
        </button>
        <button type="button" onClick={onCancelConfirm}>
          {text.code.cancel}
        </button>
      </div>
    );
  }
  const selected = active === node.path;
  return (
    <div className={selected ? "row on" : "row"} style={{ paddingLeft: pad }}>
      <button type="button" className="file" onClick={() => onOpen(node.path)} title={node.path}>
        {node.name}
      </button>
      <span className="row-actions">
        <button type="button" aria-label={`${text.code.rename} ${node.name}`} onClick={() => onStartRename(node.path)}>
          <IconPencil />
        </button>
        <button
          type="button"
          aria-label={`${text.code.delete} ${node.name}`}
          className="danger"
          onClick={() => onAskDelete(node.path)}
        >
          <IconTrash />
        </button>
      </span>
    </div>
  );
}

function TrashRow({
  entry,
  confirming,
  onRestore,
  onAskDelete,
  onConfirmDelete,
  onCancelConfirm,
}: {
  entry: TrashedFile;
  confirming: boolean;
  onRestore: () => void;
  onAskDelete: (path: string) => void;
  onConfirmDelete: () => void;
  onCancelConfirm: () => void;
}) {
  const name = entry.file.path.split("/").pop();
  if (confirming) {
    return (
      <div className="trash-row confirm" data-testid="purge-confirm">
        <span>{text.code.confirmPurge(name ?? "")}</span>
        <button type="button" className="danger" onClick={onConfirmDelete}>
          {text.code.purgeConfirm}
        </button>
        <button type="button" onClick={onCancelConfirm}>
          {text.code.cancel}
        </button>
      </div>
    );
  }
  return (
    <div className="trash-row" title={entry.file.path}>
      <span className="trash-name">{name}</span>
      <button type="button" onClick={onRestore}>
        {text.code.restore}
      </button>
      <button type="button" className="danger" aria-label={`${text.code.purge} ${name}`} onClick={() => onAskDelete(entry.file.path)}>
        <IconTrash />
      </button>
    </div>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M11.2 2.6 13.4 4.8 6.2 12H4v-2.2z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M4.8 4.5l.6 8h5.2l.6-8" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 10.5V3.5M5 6.5 8 3.5l3 3M3.5 12.5h9" />
    </svg>
  );
}

function IconNote() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 12V4.5l5-1.2v7.2" />
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="10" cy="10.5" r="1.6" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5 9.3 6.7 13.5 8 9.3 9.3 8 13.5 6.7 9.3 2.5 8 6.7 6.7z" />
    </svg>
  );
}

function AssetThumb({ path, bytes }: { path: string; bytes?: Uint8Array }) {
  const kind = assetFilter(path);
  const url = useObjectUrl(kind === "images" ? bytes : undefined, mediaType(path));
  if (kind !== "images" || !url) return <em>{kind === "audio" ? "音频" : kind === "fonts" ? "字体" : "文件"}</em>;
  return <img src={url} alt="" />;
}

function useObjectUrl(bytes: Uint8Array | undefined, type: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!bytes) return;
    const copy = new Uint8Array(bytes);
    const next = URL.createObjectURL(new Blob([copy], { type }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, type]);
  return url;
}
