import { useEffect, useRef } from "react";
import { RUNTIME } from "../lib/build";
import { parseGamekitEvent } from "../lib/messages";
import { useStudio } from "../studio/store";
import { text } from "./text";

/**
 * The stage: the one place a game runs, whether it is the child's own build or a
 * candidate version. It stays mounted across views, so switching to 看代码 never
 * restarts the game.
 */
export function Stage() {
  const studio = useStudio();
  const frame = useRef<HTMLIFrameElement>(null);
  const studioRef = useRef(studio);
  studioRef.current = studio;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (frame.current?.contentWindow && event.source !== frame.current.contentWindow) return;
      const payload = parseGamekitEvent(event.data);
      if (!payload) return;
      if (payload.type === "archive-request") {
        studioRef.current.sendPreviewArchive(event.source as WindowProxy | null);
        return;
      }
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
    if (studio.frameSrc === "about:blank") return;
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

  const idle = studio.runState === "idle" || studio.runState === "stopped";

  return (
    <section className="stage-pane">
      <div className="stage-bar">
        <span className={`stage-badge owner-${studio.stageOwner}`}>
          {studio.stageOwner === "candidate" ? text.stage.candidate : text.stage.mine}
        </span>
        <span className="stage-note">{studio.statusNote}</span>
        <b>{studio.fps === null ? "FPS —" : `FPS ${Math.round(studio.fps)}`}</b>
        {!idle ? (
          <button className="stop" type="button" onClick={studio.stop}>
            <i />
            {text.stage.stop}
          </button>
        ) : null}
      </div>
      <div className="stage-screen" data-testid="stage" onPointerDown={focusGame}>
        <iframe
          ref={frame}
          title={text.brand.name}
          sandbox="allow-scripts"
          src={studio.frameSrc}
          srcDoc={studio.frameHtml}
          allow="autoplay; fullscreen; gamepad"
          onLoad={focusGame}
        />
        {idle ? (
          <div className="stage-idle">
            <button className="play" type="button" onClick={() => void studio.run()}>
              <i />
              {text.stage.play}
            </button>
            <small>
              {text.stage.empty} {text.stage.runtime(RUNTIME.version, RUNTIME.pybuild)}
            </small>
          </div>
        ) : null}
      </div>
      <p className="stage-hint">{text.stage.clickToPlay}</p>
    </section>
  );
}
