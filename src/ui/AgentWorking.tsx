import { useStudio } from "../studio/store";
import { text } from "./text";

/**
 * Live status while a round is running: a chip in the header (visible from either
 * view, so a background round is never a mystery) and a strip above the ask box.
 */
export function AgentWorking({ where }: { where: "header" | "pane" }) {
  const studio = useStudio();
  if (!studio.turnBusy) return null;
  const label = studio.activeStep ? text.stepsWorking[studio.activeStep.kind] : text.pane.busy;
  return (
    <div
      className={`working working-${where}`}
      role="status"
      aria-live="polite"
      data-testid={`agent-${where}`}
    >
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="working-label">{label}</span>
    </div>
  );
}
