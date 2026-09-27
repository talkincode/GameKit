import { useEffect, useRef } from "react";
import { RUNTIME } from "../lib/build";
import { parseGamekitEvent } from "../lib/messages";
import { useStudio } from "../studio/store";

export function PreviewPane() {
  const studio = useStudio();
  const frame = useRef<HTMLIFrameElement>(null);
  const studioRef = useRef(studio);
  studioRef.current = studio;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (frame.current?.contentWindow && event.source !== frame.current.contentWindow) return;
      const payload = parseGamekitEvent(event.data);
      if (!payload) return;
      if (payload.type === "console") studioRef.current.noteConsole(payload.text);
      if (payload.type === "ready") studioRef.current.noteReady();
      if (payload.type === "tick") studioRef.current.noteTick(payload.fps, payload.frameMs);
      if (payload.type === "raf" && studioRef.current.runState === "running") {
        studioRef.current.noteTick(payload.fps, studioRef.current.frameMs ?? 0);
      }
      if (payload.type === "input") studioRef.current.noteInput(payload.detail);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!frame.current || studio.frameSrc === "about:blank") return;
    const timer = window.setInterval(() => {
      const doc = frame.current?.contentDocument;
      if (!doc) return;
      const info = doc.querySelector("#infobox");
      const status = doc.querySelector("#status");
      const note = info instanceof HTMLElement && info.style.display !== "none" ? info.innerText.trim() : "";
      const loading = status instanceof HTMLElement ? status.innerText.trim() : "";
      if (studioRef.current.runState === "starting" && (loading || note)) {
        studioRef.current.noteStatus(loading || note);
      }
      const terminal = doc.querySelector("#terminal")?.textContent ?? "";
      if (terminal.includes("default.tmpl: done")) studioRef.current.noteReady();
    }, 400);
    return () => window.clearInterval(timer);
  }, [studio.frameSrc]);

  const focusGame = () => {
    const canvas = frame.current?.contentDocument?.getElementById("canvas");
    canvas?.focus();
    frame.current?.contentWindow?.focus();
  };

  return (
    <section className="preview">
      <div className="preview-bar">
        <strong>Preview</strong>
        <span>{studio.statusNote}</span>
        <b>{studio.fps === null ? "FPS —" : `FPS ${Math.round(studio.fps)}`}</b>
      </div>
      <div className="stage" onPointerDown={focusGame}>
        <iframe
          ref={frame}
          title="Game preview"
          src={studio.frameSrc}
          allow="autoplay; fullscreen; gamepad"
          onLoad={focusGame}
        />
        {studio.runState === "idle" || studio.runState === "stopped" ? (
          <div className="stage-idle">
            <p>Press Run. The game uses the same pygame-ce runtime as an export.</p>
            <small>Runtime {RUNTIME.version} · Python {RUNTIME.pybuild}</small>
          </div>
        ) : null}
      </div>
      <p className="hint">Click the preview so the keyboard reaches the game. The first click also unlocks audio.</p>
    </section>
  );
}
