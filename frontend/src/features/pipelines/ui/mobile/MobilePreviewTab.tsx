// MobilePreviewTab -- HEL-1582 (design.md D8): the Preview tab. A step chooser ("Step N · label", default the last
// step of the first source's trunk; every lane's steps are listed) above the chosen step's preview table, which
// carries the step's output schema chips. Mounted only while the tab is active, so opening the page issues no
// preview request (HEL-1620).

import { GitBranch } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Select, type SelectOption } from "../../../../shared/ui/Select";
import type { InFlightDedupe } from "../../state/inFlightDedupe";
import type { PipelinePageState } from "../spine/PipelineSpineLayout";
import { StepPreviewTable } from "../spine/StepPreviewTable";

export function MobilePreviewTab({
  page,
  dedupe,
  beforeFetch,
}: {
  page: PipelinePageState;
  dedupe: InFlightDedupe;
  beforeFetch: () => Promise<void>;
}) {
  const { steps, laneGraph, roots } = page;
  const [chosenId, setChosenId] = useState<string | null>(null);

  const entries = laneGraph.lanes.flatMap((lane) =>
    lane.steps.map((step, index) => ({ step, lane, index })),
  );
  if (entries.length === 0) {
    return (
      <EmptyState
        variant="main"
        icon={<GitBranch />}
        title="Nothing to preview yet"
        description="Add a step on the Steps tab to see the rows it produces."
      />
    );
  }

  const trunk = laneGraph.lanes.find(
    (l) => l.parentStepId === undefined && l.rootId === roots[0]?.id,
  );
  const defaultId = trunk?.steps.at(-1)?.id ?? entries[0].step.id;
  const chosen =
    entries.find((e) => e.step.id === chosenId) ??
    entries.find((e) => e.step.id === defaultId) ??
    entries[0];
  const options: SelectOption[] = entries.map((e) => ({
    value: e.step.id,
    label: `Step ${e.index + 1} · ${e.step.label}`,
  }));
  const enabledBits = steps.map((s) => (s.enabled ? "1" : "0")).join("");

  return (
    <div className="mobile-preview">
      <Select
        className="mobile-preview__select"
        ariaLabel="Previewed step"
        value={chosen.step.id}
        options={options}
        onChange={setChosenId}
      />
      <StepPreviewTable
        key={chosen.step.id}
        pipelineId={page.id ?? ""}
        step={chosen.step}
        stepNumber={chosen.index + 1}
        stepIndex={chosen.index}
        enabledBits={enabledBits}
        analyzeSchema={page.getAnalyzeSchema(chosen.step.id)}
        analyzeOutputSchema={page.getAnalyzeOutputSchema(chosen.step.id)}
        hasOwnAnalyze={page.hasOwnAnalyzeEntry(chosen.step.id)}
        isCreating={page.creatingStepIds.has(chosen.step.id)}
        dedupe={dedupe}
        beforeFetch={beforeFetch}
      />
    </div>
  );
}
