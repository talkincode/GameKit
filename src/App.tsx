import { useEffect, useState } from "react";
import { BottomPanel } from "./ui/BottomPanel";
import { CodePane } from "./ui/CodePane";
import { DesignerPane } from "./ui/DesignerPane";
import { Overlays } from "./ui/Overlays";
import { ProjectsPanel } from "./ui/ProjectsPanel";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Sidebar } from "./ui/Sidebar";
import { Stage } from "./ui/Stage";
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
  // Monaco is heavy; build it the first time the child opens 看代码, then keep it
  // mounted so switching views never loses the file or the editor state.
  const [codeSeen, setCodeSeen] = useState(false);
  useEffect(() => {
    if (studio.view === "code") setCodeSeen(true);
  }, [studio.view]);

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

  // Panels collapse to nothing; the editor always keeps the remaining space.
  const columns = [
    studio.panels.side ? "232px" : "0px",
    "minmax(0, 1fr)",
    studio.panels.stage ? "minmax(320px, 32vw)" : "0px",
  ].join(" ");
  const rows = `minmax(0, 1fr) ${studio.panels.bottom ? "208px" : "0px"}`;

  return (
    <div
      className={`shell view-${studio.view}`}
      style={{ ["--code-columns" as string]: columns, ["--code-rows" as string]: rows }}
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
      <main className="studio">
        <Stage />
        <DesignerPane />
        {codeSeen ? (
          <>
            {studio.panels.side ? <Sidebar /> : null}
            <CodePane />
            {studio.panels.bottom ? <BottomPanel /> : null}
          </>
        ) : null}
      </main>
      <Overlays />
      <ProjectsPanel />
      <SettingsPanel />
      {studio.notice ? (
        <button className="notice" type="button" data-testid="notice" onClick={studio.dismissNotice}>
          {studio.notice}
        </button>
      ) : null}
    </div>
  );
}
