// MobilePreviewTab -- HEL-1582 (design.md D8): the Preview tab. A step chooser ("Step N · label", default the last
// step of the first source's trunk; every lane's steps are listed) above the chosen step's preview table, which
// carries the step's output schema chips. Mounted only while the tab is active, so opening the page issues no
// preview request (HEL-1620).

import { GitBranch } from "lucide-react";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Select, type SelectOption } from "../../../../shared/ui/Select";
import type { usePipelineDraftPresentation } from "../../hooks/usePipelineDraftPresentation";
import type { InFlightDedupe } from "../../state/inFlightDedupe";
import type { OutputPick } from "../../state/liveOutput/resolveDisplayedOutput";
import type { LaneGraph } from "../../state/stepTree";
import type { PipelineRoot } from "../../types/pipelineStep";
import type { PipelinePageState } from "../spine/PipelineSpineLayout";
import { StepPreviewTable } from "../spine/StepPreviewTable";
import { LiveOutputColumn } from "../liveOutput/LiveOutputColumn";

/** The step the tab previews until the user picks another: the last step of the first source's trunk, else the first step. */
export function defaultPreviewStepId(laneGraph: LaneGraph, roots: PipelineRoot[]): string | null {
  const trunk = laneGraph.lanes.find(
    (l) => l.parentStepId === undefined && l.rootId === roots[0]?.id,
  );
  return (
    trunk?.steps.at(-1)?.id ?? laneGraph.lanes.find((l) => l.steps.length > 0)?.steps[0].id ?? null
  );
}

/** The step the Preview tab shows for `chosenId`: the pick if it is a step, else the default, else the first step; `null` with
 *  no steps. The tab and the layout (which resolves the displayed Output against it, HEL-1705) both read this one function. */
export function resolvePreviewStepId(
  laneGraph: LaneGraph,
  roots: PipelineRoot[],
  chosenId: string | null,
): string | null {
  const ids = laneGraph.lanes.flatMap((lane) => lane.steps.map((s) => s.id));
  if (ids.length === 0) return null;
  if (chosenId !== null && ids.includes(chosenId)) return chosenId;
  const defaultId = defaultPreviewStepId(laneGraph, roots) ?? ids[0];
  return ids.includes(defaultId) ? defaultId : ids[0];
}

export function MobilePreviewTab({
  page,
  dedupe,
  beforeFetch,
  presentation,
  chosenId,
  onChoose,
  outputPick,
  onPickOutput,
}: {
  page: PipelinePageState;
  dedupe: InFlightDedupe;
  beforeFetch: () => Promise<void>;
  presentation: ReturnType<typeof usePipelineDraftPresentation>;
  /** The user's pick, or `null` for the default step. Held by the layout, which needs it for the draft transport. */
  chosenId: string | null;
  onChoose: (stepId: string) => void;
  /** The explicit Output pick, held by the layout with the draft transport (HEL-1705). */
  outputPick: OutputPick | null;
  onPickOutput: (pick: OutputPick) => void;
}) {
  const { laneGraph, roots } = page;

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

  const resolvedId = resolvePreviewStepId(laneGraph, roots, chosenId);
  const chosen = entries.find((e) => e.step.id === resolvedId) ?? entries[0];
  const options: SelectOption[] = entries.map((e) => ({
    value: e.step.id,
    label: `Step ${e.index + 1} · ${e.step.label}`,
  }));
  const draftSchema = presentation.inputSchemaFor(chosen.step);

  return (
    <div className="mobile-preview">
      <Select
        className="mobile-preview__select"
        ariaLabel="Previewed step"
        value={chosen.step.id}
        options={options}
        onChange={onChoose}
      />
      <StepPreviewTable
        key={chosen.step.id}
        pipelineId={page.id ?? ""}
        step={chosen.step}
        stepNumber={chosen.index + 1}
        stepIndex={chosen.index}
        enabledBits={presentation.savedEnabledBits}
        analyzeSchema={draftSchema ?? page.getAnalyzeSchema(chosen.step.id)}
        analyzeOutputSchema={page.getAnalyzeOutputSchema(chosen.step.id)}
        hasOwnAnalyze={page.hasOwnAnalyzeEntry(chosen.step.id)}
        isCreating={page.creatingStepIds.has(chosen.step.id)}
        dedupe={dedupe}
        beforeFetch={beforeFetch}
        draft={presentation.previewDraftFor(chosen.step.id)}
      />
      <LiveOutputColumn
        page={page}
        presentation={presentation}
        selectedStepId={chosen.step.id}
        pick={outputPick}
        onPick={onPickOutput}
        layout="phone"
      />
    </div>
  );
}
