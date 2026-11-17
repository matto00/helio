// Output editor sheet (task 5.1) -- kind + name + capabilities-at-node-driven
// mapping shell, built from `BindingEditor.tsx` (design.md decision 3). Opens
// against either an existing `Output` (edit) or a target step id with no
// Output yet (create). Owns its own save/create/delete + live-preview
// plumbing; `PipelineDetailPage` only owns open/close state.
//
// The per-kind editor state lives in `useOutputKindState.ts` (seeded from
// `configPatch.ts`'s `openingParams`); config assembly in `buildOutputConfig.ts`;
// the Configuration card, Preview card, footer and placements list in their
// own files beside this one. This file keeps the top-level fields and the
// save/create/delete lifecycle.

import { useEffect, useId, useMemo, useState } from "react";

import { Modal, Select, TextField, type SelectOption } from "../../../../shared/ui/index";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { toChartFieldTypes } from "../../../../utils/chartTimeAxis";
import type { Output, OutputKind } from "../../types/output";
import type { AggregateConfig } from "../../types/pipelineStep";
import {
  useOutputImmediateActions,
  type OutputActions,
} from "../../hooks/useOutputImmediateActions";
import { isDraftOutput } from "../../state/draftOutputs";
import type { Step } from "../../types/step";
import { aggColumnOptions, columnOptions } from "./outputConfigTypes";
import {
  buildAggregateTailConfigs,
  buildOutputConfig,
  canAddAsTailWithAggregate,
} from "./buildOutputConfig";
import { buildBaselineConfig, buildConfigPatch } from "./configPatch";
import { HistoryPayloadsField } from "./HistoryPayloadsField";
import { OutputEditorFooter } from "./OutputEditorFooter";
import { OutputKindConfigCard } from "./OutputKindConfigCard";
import { OutputPlacementsList } from "./OutputPlacementsList";
import { OutputSheetPreviewCard } from "./OutputSheetPreviewCard";
import { useOutputKindState } from "./useOutputKindState";
import { useOutputSavedStatus } from "./useOutputSavedStatus";
import { useOutputSheetNode } from "./useOutputSheetNode";
import { PICK_STEP_HINT, draftSheetState, type OutputSheetDraft } from "./outputSheetDraft";
import "./OutputEditorSheet.css";

const KIND_OPTIONS: SelectOption[] = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
  { value: "metric", label: "Metric" },
  { value: "collection", label: "Collection" },
  { value: "timeline", label: "Timeline" },
  { value: "markdown", label: "Markdown" },
];

interface OutputEditorSheetProps {
  open: boolean;
  onClose: () => void;
  pipelineId: string;
  /** The Output being edited, or `null` when creating a new one. */
  output: Output | null;
  /** Target step for a NEW Output (`undefined` = pipeline root). Ignored when
   *  `output` is set (an existing Output's `nodeStepId` is immutable here). */
  createTargetStepId?: string;
  /** Every trunk/tail step, for the create-time step picker (task 4.4). */
  steps: Step[];
  /** task 5.6 -- "Add as tail with aggregate": creates a new `aggregate`
   *  pipeline step as a tail off `nodeStepId`, then this Output on the new
   *  step. Only meaningful while creating (an existing Output's node is
   *  immutable in this sheet). Omitted in contexts that don't wire it (e.g.
   *  tests exercising other slots) -- the affordance simply doesn't render. */
  onAddAsTailWithAggregate?: (
    parentStepId: string,
    aggregateConfig: AggregateConfig,
    outputPayload: { kind: string; name: string; config: Record<string, unknown> },
  ) => Promise<Output>;
  /** HEL-946 Bug C(2) — runs the pipeline from the never-materialized
   *  warning banner's affordance. Omitted in contexts that don't wire it
   *  (e.g. tests), same convention as `onAddAsTailWithAggregate`. */
  onRunPipeline?: () => void;
  /** HEL-1733 D3: the page's routed Output writes (a draft entry while a draft exists, an immediate write otherwise). Omitted in
   *  contexts that do not wire the page (tests): the sheet then writes immediately itself. */
  actions?: OutputActions;
  /** HEL-1733: given only while a pipeline draft exists. Save/Delete then record draft entries, the columns and preview come from the
   *  draft, and nothing is written or read by a draft-only id. */
  draft?: OutputSheetDraft;
}

export function OutputEditorSheet({
  open,
  onClose,
  pipelineId,
  output,
  createTargetStepId,
  steps,
  onAddAsTailWithAggregate,
  onRunPipeline,
  actions,
  draft,
}: OutputEditorSheetProps) {
  const immediate = useOutputImmediateActions(pipelineId);
  const write = actions ?? immediate;
  const isCreate = output === null;
  // A created Output has no server row (its id is a client id): treated like a create for every stored-resource read.
  const hasServerRow = !isCreate && output !== null && !isDraftOutput(output);
  const kindHintId = useId();

  const [nodeStepId, setNodeStepId] = useState<string | undefined>(
    isCreate ? createTargetStepId : output?.nodeStepId,
  );
  const [kind, setKind] = useState<OutputKind>((output?.kind as OutputKind) ?? "chart");
  const [name, setName] = useState(output?.name ?? "");
  // HEL-1331 -- seeded from the stored opt-in; sent on Save only when the user changed it (below).
  const [historyPayloads, setHistoryPayloads] = useState(output?.config?.historyPayloads === true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Re-seed the TOP-LEVEL fields whenever a different Output/create-target opens. The per-kind
  // state (`useOutputKindState`) is seeded once per mount, so a caller that swaps Outputs must
  // remount the sheet -- `PipelineDetailPage` keys it by Output id.
  useEffect(() => {
    if (!open) return;
    setNodeStepId(isCreate ? createTargetStepId : output?.nodeStepId);
    setKind((output?.kind as OutputKind) ?? "chart");
    setName(output?.name ?? "");
    setHistoryPayloads(output?.config?.historyPayloads === true);
    setSaveError(null);
    setConfirmingDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, output?.id]);

  const { capabilities, typing, previewRows } = useOutputSheetNode({
    open,
    pipelineId,
    output,
    nodeStepId,
    steps,
    draft,
  });

  const previewFieldTypes = useMemo(
    () => toChartFieldTypes(capabilities?.columns.map((c) => ({ name: c.name, type: c.dataType }))),
    [capabilities],
  );

  const { placements, neverMaterialized } = useOutputSavedStatus(open, !hasServerRow, output);

  const config = useMemo(() => output?.config ?? {}, [output]);
  const kindState = useOutputKindState(
    config,
    capabilities ? capabilities.columns.map((c) => c.name) : [],
    (output?.kind as OutputKind) ?? "chart",
  );
  // HEL-1307 -- a rule the server would reject blocks Save (the editor mirrors the server's checks).
  const rulesInvalid =
    (kind === "metric" || kind === "collection" || kind === "table") &&
    kindState.conditionalFormats.hasErrors(kind);

  const fieldOptions = columnOptions(capabilities);
  const aggFieldOptions = aggColumnOptions(capabilities);
  // HEL-1311 -- the server's own "numeric for a chart value" list (the `yAxis` slot's eligibility).
  const numericColumns = capabilities?.capabilities.chart?.eligibleColumns.yAxis ?? [];

  function buildConfig(): Record<string, unknown> {
    return buildOutputConfig(kindState.params(kind));
  }

  // HEL-1331 D5 -- `historyPayloads` rides on an edit Save only when the toggle is enabled AND the
  // user changed it; otherwise the key is omitted so the server's shallow config merge preserves
  // whatever is stored (absent, null or a stale true).
  function withHistoryPayloads(built: Record<string, unknown>): Record<string, unknown> {
    const seeded = output?.config?.historyPayloads === true;
    if (output?.historyPayloadsAvailable !== true || historyPayloads === seeded) return built;
    return { ...built, historyPayloads };
  }

  // HEL-1389 -- an edit Save sends a config PATCH (only what the user changed, `null` for a clear);
  // see `configPatch.ts`. Kind is fixed in edit mode (HEL-1388: the Kind select is disabled), so the
  // `kind !== output.kind` guard is purely defensive; a differing kind would send the full config.
  function buildEditConfig(): Record<string, unknown> {
    const built = buildConfig();
    if (!output || kind !== output.kind) return built;
    const fieldKeys = capabilities ? capabilities.columns.map((c) => c.name) : [];
    const baseline = buildBaselineConfig(kind, output.config ?? {}, fieldKeys);
    return buildConfigPatch(kind, built, baseline, output.config ?? {}) ?? {};
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      if (output === null) {
        await write.create({
          nodeStepId,
          kind,
          name: name.trim() || "Untitled output",
          config: buildConfig(),
        });
      } else {
        const patch = withHistoryPayloads(buildEditConfig());
        // `config` is omitted entirely when nothing in it changed.
        await write.update(output, {
          name: name.trim(),
          ...(Object.keys(patch).length > 0 ? { config: patch } : {}),
        });
      }
      onClose();
    } catch (err) {
      // The thunks reject with the server's message (`rejectWithValue`), which names a rejected
      // config key/aggregation (HEL-1313); anything else keeps the generic text.
      setSaveError(
        typeof err === "string" && err
          ? err
          : err instanceof Error
            ? err.message
            : "Failed to save output.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!output) return;
    setSaving(true);
    try {
      await write.remove(output);
      onClose();
    } catch {
      setSaveError("Failed to delete output.");
      setSaving(false);
    }
  }

  const { stepOptions, needsStepPick, saveWaits, hint } = draftSheetState({
    draft,
    steps,
    isCreate,
    nodeStepId,
    kind,
    typing,
  });

  // task 5.6 -- "Add as tail with aggregate": only meaningful while
  // creating, against a real node (an aggregate step needs a `parentStepId`
  // -- the pipeline root has no step id to attach off), for the two kinds
  // that carry aggregation fields in this sheet.
  const canAddTailWithAggregate =
    isCreate &&
    Boolean(nodeStepId) &&
    Boolean(onAddAsTailWithAggregate) &&
    canAddAsTailWithAggregate(kindState.params(kind));

  async function handleAddTailWithAggregate() {
    if (!onAddAsTailWithAggregate || !nodeStepId) return;
    const built = buildAggregateTailConfigs(kindState.params(kind), capabilities);
    if (!built) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onAddAsTailWithAggregate(nodeStepId, built.aggregateConfig, {
        kind,
        name: name.trim() || "Untitled output",
        config: built.outputConfig,
      });
      onClose();
    } catch {
      setSaveError("Failed to add tail with aggregate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isCreate ? "New output" : `Edit ${output?.name ?? "output"}`}
      open={open}
      onClose={onClose}
      size="lg"
      footer={
        <OutputEditorFooter
          isCreate={isCreate}
          confirmingDelete={confirmingDelete}
          onDeleteClick={() => (confirmingDelete ? void handleDelete() : setConfirmingDelete(true))}
          placements={placements}
          saving={saving}
          onClose={onClose}
          canAddTailWithAggregate={canAddTailWithAggregate}
          onAddTailWithAggregate={() => void handleAddTailWithAggregate()}
          onSave={() => void handleSave()}
          saveBlocked={
            rulesInvalid ||
            (kind === "chart" && (kindState.binCountInvalid || kindState.referenceMarksInvalid)) ||
            saveWaits
          }
        />
      }
    >
      <div className="output-editor-sheet__group">
        <div className="output-editor-sheet__data-section">
          <label className="output-editor-sheet__data-label" htmlFor="output-name">
            Name
          </label>
          <TextField
            id="output-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled output"
          />
        </div>

        {isCreate && (
          <div className="output-editor-sheet__data-section">
            <label className="output-editor-sheet__data-label" htmlFor="output-step">
              Step
            </label>
            <Select
              id="output-step"
              ariaLabel="Target step"
              value={nodeStepId ?? ""}
              onChange={(v) => {
                const next = v === "" ? undefined : v;
                setNodeStepId(next);
                draft?.onNodeChange(next);
              }}
              options={stepOptions}
            />
            {needsStepPick && <p className="output-editor-sheet__field-hint">{PICK_STEP_HINT}</p>}
          </div>
        )}

        <div className="output-editor-sheet__data-section">
          <label className="output-editor-sheet__data-label" htmlFor="output-kind">
            Kind
          </label>
          <Select
            id="output-kind"
            ariaLabel="Output kind"
            value={kind}
            onChange={(v) => setKind(v as OutputKind)}
            options={KIND_OPTIONS}
            disabled={!isCreate}
            ariaDescribedBy={isCreate ? undefined : kindHintId}
          />
          {!isCreate && (
            <p id={kindHintId} className="output-editor-sheet__field-hint">
              An Output&apos;s kind can&apos;t be changed after it&apos;s created. Create a new
              Output for a different kind.
            </p>
          )}
        </div>
        {hint !== null && (
          <p className="output-editor-sheet__draft-hint" role="status">
            {hint}
          </p>
        )}
      </div>

      <OutputKindConfigCard
        kind={kind}
        kindState={kindState}
        aggFieldOptions={aggFieldOptions}
        fieldOptions={fieldOptions}
        numericColumns={numericColumns}
      />

      {!isCreate && (
        <div className="output-editor-sheet__group output-editor-sheet__group--card">
          <h3 className="output-editor-sheet__edit-section-heading">History</h3>
          <HistoryPayloadsField
            checked={historyPayloads}
            onChange={setHistoryPayloads}
            available={output?.historyPayloadsAvailable === true}
            limits={output?.historyPayloadLimits}
          />
        </div>
      )}

      <OutputSheetPreviewCard
        kind={kind}
        kindState={kindState}
        rows={previewRows}
        neverMaterialized={neverMaterialized}
        fieldTypes={previewFieldTypes}
        onRunPipeline={onRunPipeline}
      />

      {!isCreate && placements && <OutputPlacementsList placements={placements} />}

      <InlineError error={saveError} />
    </Modal>
  );
}
