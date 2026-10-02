import { useEffect, useState } from "react";
import { assetFilter, fileTree, mediaType, type TreeNode } from "../lib/project";
import { useStudio } from "../studio/store";
import { text } from "./text";

export function Sidebar() {
  const studio = useStudio();
  const [pane, setPane] = useState<"files" | "assets">("files");
  const [draft, setDraft] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const project = studio.project;
  if (!project) return <aside className="sidebar" />;

  const tree = fileTree(project.files.map((file) => file.path));
  const assets = project.files.filter((file) => assetFilter(file.path));

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
          <div className="side-actions">
            <button type="button" onClick={() => setDraft("game/new.py")}>
              {text.code.newFile}
            </button>
            <button type="button" onClick={() => setRename(studio.path)}>
              {text.code.rename}
            </button>
            <button type="button" onClick={studio.removeCurrent}>
              {text.code.delete}
            </button>
          </div>
          {draft !== null ? (
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                studio.createFile(draft);
                setDraft(null);
              }}
            >
              <input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
              <button type="submit">{text.code.open}</button>
            </form>
          ) : null}
          {rename ? (
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                studio.renameCurrent(rename);
                setRename("");
              }}
            >
              <input value={rename} onChange={(event) => setRename(event.target.value)} autoFocus />
              <button type="submit">OK</button>
            </form>
          ) : null}
          <div className="tree">
            {tree.map((node) => (
              <Node key={node.path} node={node} depth={0} active={studio.path} onOpen={studio.setPath} />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="side-actions">
            <label className="file-btn">
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
            <button type="button" onClick={() => studio.setAssetOpen(true)}>
              {text.code.generate}
            </button>
          </div>
          <div className="asset-grid">
            {assets.map((file) => (
              <button
                key={file.path}
                type="button"
                className={file.path === studio.path ? "card on" : "card"}
                onClick={() => studio.setPath(file.path)}
              >
                <AssetThumb path={file.path} bytes={file.bytes} />
                <span>{file.path.split("/").pop()}</span>
              </button>
            ))}
            {!assets.length ? <p className="empty">{text.code.upload}</p> : null}
          </div>
        </>
      )}
    </aside>
  );
}

function Node({
  node,
  depth,
  active,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  active: string;
  onOpen: (path: string) => void;
}) {
  if (!node.file) {
    return (
      <div>
        <div className="dir" style={{ paddingLeft: 8 + depth * 12 }}>
          {node.name}
        </div>
        {node.children.map((child) => (
          <Node key={child.path} node={child} depth={depth + 1} active={active} onOpen={onOpen} />
        ))}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={active === node.path ? "file on" : "file"}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => onOpen(node.path)}
    >
      {node.name}
    </button>
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
