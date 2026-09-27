import { useEffect } from "react";
import { BottomPanel } from "./ui/BottomPanel";
import { CodePane } from "./ui/CodePane";
import { Overlays } from "./ui/Overlays";
import { PreviewPane } from "./ui/PreviewPane";
import { Sidebar } from "./ui/Sidebar";
import { Toolbar } from "./ui/Toolbar";
import { StudioProvider, useStudio } from "./studio/store";

export function App() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  );
}

function Shell() {
  const studio = useStudio();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        void studio.run();
      }
      if (event.key === "F6") {
        event.preventDefault();
        studio.stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [studio]);

  return (
    <div
      className="shell"
      style={{ ["--side" as string]: `${studio.side}px`, ["--bottom" as string]: `${studio.bottom}px` }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const files = [...event.dataTransfer.files];
        if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
          void studio.importArchive(files[0]);
          return;
        }
        for (const file of files) {
          void file.arrayBuffer().then((buffer) => {
            const base = file.name.replace(/[^\w.\- ]+/g, "").trim() || "asset.bin";
            studio.addBytes(`assets/${base}`, new Uint8Array(buffer));
          });
        }
      }}
    >
      <Toolbar />
      <div className="workspace">
        <Sidebar />
        <Splitter
          label="Resize file list"
          onDelta={(delta) => studio.setSide(clamp(studio.side + delta, 188, 420))}
        />
        <CodePane />
        <PreviewPane />
      </div>
      <Splitter
        label="Resize console"
        row
        onDelta={(delta) => studio.setBottom(clamp(studio.bottom - delta, 108, 420))}
      />
      <BottomPanel />
      <Overlays />
      {studio.notice ? (
        <button className="notice" type="button" onClick={studio.dismissNotice}>
          {studio.notice}
        </button>
      ) : null}
    </div>
  );
}

function Splitter({ label, row, onDelta }: { label: string; row?: boolean; onDelta: (delta: number) => void }) {
  return (
    <div
      className={row ? "gutter gutter-row" : "gutter"}
      role="separator"
      aria-orientation={row ? "horizontal" : "vertical"}
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault();
        let origin = row ? event.clientY : event.clientX;
        const move = (next: PointerEvent) => {
          const point = row ? next.clientY : next.clientX;
          onDelta(point - origin);
          origin = point;
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
      }}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
