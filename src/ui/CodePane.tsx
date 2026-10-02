import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import "monaco-editor/languages/definitions/python/register.js";
import "monaco-editor/languages/definitions/html/register.js";
import "monaco-editor/languages/definitions/css/register.js";
import { useEffect, useState } from "react";
import { assetFilter, editorLanguage, mediaType } from "../lib/project";
import { useStudio } from "../studio/store";
import { text } from "./text";

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};
loader.config({ monaco });

export function CodePane() {
  const studio = useStudio();
  const file = studio.project?.files.find((item) => item.path === studio.path);
  const kind = file ? assetFilter(file.path) : null;
  const url = useObjectUrl(file?.bytes, file ? mediaType(file.path) : "");
  const canExplain = !!file?.text;

  return (
    <section className="editor">
      <div className="tabs">
        <span>{studio.path || text.code.files}</span>
        <div className="inline-ai">
          <button
            type="button"
            data-testid="explain"
            disabled={!canExplain}
            title={text.code.explain}
            onClick={() => void studio.explainSelection()}
          >
            {studio.aiBusy ? text.pane.explainBusy : text.code.explain}
          </button>
        </div>
      </div>
      {!file ? (
        <p className="empty pad">{text.code.empty}</p>
      ) : file.text !== undefined && !file.bytes ? (
        <Editor
          key={file.path}
          language={editorLanguage(file.path)}
          theme="vs-dark"
          value={file.text}
          onChange={(value) => studio.updateText(file.path, value ?? "")}
          onMount={(editor) => {
            editor.onDidChangeCursorSelection(() => {
              const model = editor.getModel();
              const selection = editor.getSelection();
              if (!model || !selection || selection.isEmpty()) studio.setSelection("");
              else studio.setSelection(model.getValueInRange(selection));
            });
          }}
          options={{
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 12 },
            smoothScrolling: true,
            tabSize: 4,
            automaticLayout: true,
            overviewRulerLanes: 0,
          }}
        />
      ) : kind === "images" && url ? (
        <div className="preview-asset">
          <img src={url} alt={file.path} />
        </div>
      ) : kind === "audio" && url ? (
        <div className="preview-asset">
          <audio src={url} controls />
          <p>{file.path}</p>
        </div>
      ) : (
        <p className="empty pad">{text.code.binary}</p>
      )}
    </section>
  );
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
