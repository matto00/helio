// StepPreviewTable -- HEL-1579 (design.md D8): the rows after the selected step, under the focused editor.
// Header: "Rows after step <n>", the row count (mono), the step's schema-diff chips and the step's output
// schema chips (moved here from the footer; `OutputSchemaDisclosure` above the existing threshold).
// Columns carry their data type (from analyze) in the header. States: loading (skeleton rows), error
// (`role=alert`, the named `STEP_CONFIG_INVALID` reason as the card tray shows it), empty, a disabled step
// (rows pass through unchanged, no fetch) and a step still being created (no fetch).
//
// HEL-1631: while a draft exists (`draft.active`) the table shows the step's DRAFT rows, computed in the browser, with the
// "live" marker (DESIGN.md §11: only on a surface recomputed from the draft), an updating or stale caption, and the rows
// that were not in the step's previous frame flashed once. No step-preview request is sent then; the saved-config fetch is
// keyed on the SAVED step only, so a draft edit and Discard never refetch.
//
// The component is keyed by the selected step id, so every selection mounts it fresh and fetches fresh.

import { useMemo, useState } from "react";

import { DataGrid, Skeleton } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";
import { SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD } from "../../../../shared/ui/useSchemaFieldSearch";
import { frameSchema, toJsonRows } from "../../evaluator";
import type { Frame } from "../../evaluator";
import { useStepPreviewFetch, type SavedPreviewCache } from "../../hooks/useStepPreviewFetch";
import { fetchStepPreview } from "../../services/pipelineService";
import type { DraftStepView } from "../../state/draftStepView";
import type { InFlightDedupe } from "../../state/inFlightDedupe";
import { isTempStepId, renamesOf } from "../../state/stepNarrowing";
import type { SchemaField } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { OutputSchemaDisclosure } from "../OutputSchemaDisclosure";
import { StepSchemaDiffChips } from "../StepSchemaDiffChips";
import "./StepPreviewTable.css";

/** The draft side of the table (HEL-1631). */
export interface StepPreviewDraft {
  /** A draft exists: show draft rows, send no step-preview request. */
  active: boolean;
  /** This step's draft view; `undefined` while it is not computed yet. */
  view: DraftStepView | undefined;
  /** The step as saved (its config and flag key the saved-preview fetch); `undefined` for a step the saved pipeline lacks. */
  savedStep: Step | undefined;
  /** The step's frame in the SAVED pipeline over the same sample: what the first edit is compared against for the flash. */
  baseRows: Frame | undefined;
  /** Saved previews already fetched on this page (see `SavedPreviewCache`). */
  savedCache: SavedPreviewCache;
}

/** At most this many draft rows are rendered; the count above shows the whole frame. */
const DRAFT_ROWS_SHOWN = 50;
/** A frame this much new is whole-table churn, not a change worth flashing. */
const FLASH_ROW_CAP = 200;
/** How many rows of a frame the flash compares (the cap counts new rows among these). */
const FLASH_SCAN_ROWS = 1000;

const rowKey = (row: Record<string, unknown>): string => JSON.stringify(row);

interface FlashState {
  source: Frame | null;
  keys: ReadonlySet<string>;
  shown: Array<Record<string, null | boolean | string | number>>;
  /** `rowKey`s of the rows new in this frame. */
  changed: ReadonlySet<string>;
}

const NO_FLASH: FlashState = { source: null, keys: new Set(), shown: [], changed: new Set() };

interface StepPreviewTableProps {
  pipelineId: string;
  step: Step;
  /** HEL-1631: the draft state; absent where no draft can exist. */
  draft?: StepPreviewDraft;
  /** 1-based number within the step's lane (the "step <n>" in the header). */
  stepNumber: number;
  /** The step's index in its lane, folded into the refetch fingerprint so a reorder refreshes. */
  stepIndex: number;
  /** One bit per step (HEL-412 Decision 8): toggling any step can change what this prefix executes. */
  enabledBits: string;
  analyzeSchema: SchemaField[];
  analyzeOutputSchema: SchemaField[];
  /** False while a created draft is still on the anchor-derived fallback schema (HEL-1340). */
  hasOwnAnalyze: boolean;
  isCreating: boolean;
  /** Page-scoped in-flight-only dedupe, keyed here by step id + config fingerprint (design.md D8). */
  dedupe: InFlightDedupe;
  /** Resolves once every pending step save has settled (design.md D8). */
  beforeFetch: () => Promise<void>;
}

export function StepPreviewTable({
  pipelineId,
  step,
  stepNumber,
  stepIndex,
  enabledBits,
  analyzeSchema,
  analyzeOutputSchema,
  hasOwnAnalyze,
  isCreating,
  dedupe,
  beforeFetch,
  draft,
}: StepPreviewTableProps) {
  const isDraft = isTempStepId(step.id);
  // The saved-config fetch follows the SAVED step (HEL-1631 D7a): a draft edit never changes what it asks for.
  const fetchStep = draft?.savedStep ?? step;
  const draftActive = draft !== undefined && draft.active;
  const canFetch = fetchStep.enabled && !isCreating && !isDraft;
  const configFingerprint = `${stepIndex}:${enabledBits}:${JSON.stringify(fetchStep.config)}`;

  const { previewRows, previewRowCount, previewError } = useStepPreviewFetch({
    pipelineId,
    stepId: step.id,
    stepEnabled: fetchStep.enabled,
    active: canFetch,
    paused: draftActive,
    cache: draft?.savedCache,
    configFingerprint,
    fetcher: (pid, sid) =>
      dedupe.run(`${sid}:${configFingerprint}`, () => fetchStepPreview(pid, sid)),
    beforeFetch,
  });

  const columns = useMemo<ColumnDef[] | undefined>(
    () =>
      analyzeOutputSchema.length > 0
        ? analyzeOutputSchema.map((f) => ({ key: f.name, header: f.name, headerType: f.type }))
        : undefined,
    [analyzeOutputSchema],
  );

  const view = draft !== undefined && draft.active ? draft.view : undefined;
  const draftFrame = view?.rows ?? null;

  // The flash (design.md D8): rows of this step's new frame that were not in its previous frame. State, set while rendering
  // when the frame object changes; the first frame is compared with the saved pipeline's frame for the same step.
  const [flash, setFlash] = useState<FlashState>(NO_FLASH);
  if (draft !== undefined && draftActive && draftFrame !== flash.source) {
    // The comparison scans the first FLASH_SCAN_ROWS rows (not just the ones shown), so the cap sees a real churn.
    const scanned = draftFrame === null ? [] : toJsonRows(draftFrame.slice(0, FLASH_SCAN_ROWS));
    const shown = scanned.slice(0, DRAFT_ROWS_SHOWN);
    const previousKeys =
      flash.source !== null
        ? flash.keys
        : new Set(toJsonRows((draft.baseRows ?? []).slice(0, FLASH_SCAN_ROWS)).map(rowKey));
    const comparable = flash.source !== null || draft.baseRows !== undefined;
    const scannedKeys = scanned.map(rowKey);
    const newCount = comparable ? scannedKeys.filter((k) => !previousKeys.has(k)).length : 0;
    const newKeys =
      comparable && newCount <= FLASH_ROW_CAP
        ? scannedKeys.slice(0, DRAFT_ROWS_SHOWN).filter((k) => !previousKeys.has(k))
        : [];
    setFlash({ source: draftFrame, keys: new Set(scannedKeys), shown, changed: new Set(newKeys) });
  }

  const draftColumns = useMemo<ColumnDef[] | undefined>(() => {
    if (draftFrame === null) return undefined;
    const types = new Map(analyzeOutputSchema.map((f) => [f.name, f.type]));
    const names = frameSchema(draftFrame);
    return names.map((name) => ({
      key: name,
      header: name,
      headerType: types.get(name),
      cellClassName: (row: Record<string, unknown>) =>
        flash.changed.has(rowKey(row)) ? "step-preview__cell--changed" : undefined,
    }));
  }, [draftFrame, analyzeOutputSchema, flash.changed]);

  const showDiff = !isDraft && hasOwnAnalyze && !draftActive;
  const draftCount = view?.count ?? null;
  const countText = draftActive
    ? draftCount === null
      ? null
      : `${draftCount.toLocaleString()} ${draftCount === 1 ? "row" : "rows"}`
    : canFetch && previewRowCount !== null && previewError === null
      ? `${previewRowCount.toLocaleString()} ${previewRowCount === 1 ? "row" : "rows"}`
      : null;
  const caption =
    draftActive && step.enabled && view !== undefined
      ? view.status === "pending"
        ? "updating"
        : view.status === "ok" && !view.frameStale
          ? "live"
          : view.status === "ok" || view.status === "stale" || view.status === "error"
            ? "stale"
            : null
      : null;

  let body;
  if (!step.enabled) {
    body = <p className="step-preview__note">This step is off, so rows pass through unchanged.</p>;
  } else if (isCreating || isDraft) {
    body = <p className="step-preview__note">Saving step… rows appear once it is saved.</p>;
  } else if (draftActive) {
    body = (
      <>
        {view?.status === "notPreviewed" && <p className="step-preview__note">{view.message}</p>}
        {view !== undefined && (view.status === "error" || view.status === "stale") && (
          <p
            className={view.status === "error" ? "step-preview__error" : "step-preview__note"}
            role={view.status === "error" ? "alert" : undefined}
          >
            {view.message}
            {draftFrame !== null && view.status === "error" ? " Showing its last good rows." : ""}
          </p>
        )}
        {view?.status === "pending" && draftFrame === null && (
          <div className="step-preview__loading" role="status" aria-label="Updating preview">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} variant="line" />
            ))}
          </div>
        )}
        {draftFrame !== null && view?.status !== "notPreviewed" && (
          <DataGrid
            variant="preview"
            density="condensed"
            className={`step-preview__grid${caption === "stale" || caption === "updating" ? " step-preview__grid--stale" : ""}`}
            rows={flash.shown}
            columns={draftColumns}
            emptyText="No rows to preview."
          />
        )}
        {view === undefined && (
          <p className="step-preview__note" role="status">
            Computing the draft preview…
          </p>
        )}
      </>
    );
  } else if (previewError !== null) {
    body = (
      <p className="step-preview__error" role="alert">
        {previewError}
      </p>
    );
  } else if (previewRowCount === null) {
    // Never settled yet (including the render before the fetch effect starts): loading, not "empty".
    body = (
      <div className="step-preview__loading" role="status" aria-label="Loading preview">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} variant="line" />
        ))}
      </div>
    );
  } else {
    body = (
      <DataGrid
        variant="preview"
        density="condensed"
        className="step-preview__grid"
        rows={previewRows}
        columns={columns}
        emptyText="No rows to preview."
      />
    );
  }

  return (
    <section className="step-preview" aria-label={`Rows after step ${stepNumber}`}>
      <header className="step-preview__header">
        <h2 className="step-preview__title">Rows after step {stepNumber}</h2>
        {countText !== null && <span className="step-preview__count">{countText}</span>}
        {caption !== null && (
          <span
            className={`step-preview__state step-preview__state--${caption}`}
            role="status"
            aria-label={`Preview is ${caption}`}
          >
            {caption === "live" && <span className="step-preview__live-dot" aria-hidden="true" />}
            {caption}
          </span>
        )}
        {showDiff && (
          <StepSchemaDiffChips
            input={analyzeSchema}
            output={analyzeOutputSchema}
            renames={step.opType.id === "rename" ? renamesOf(step) : undefined}
          />
        )}
        {analyzeOutputSchema.length > 0 &&
          (analyzeOutputSchema.length <= SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD ? (
            <span className="step-preview__schema" aria-label="Output schema">
              {analyzeOutputSchema.map((field) => (
                <span key={field.name} className="step-preview__schema-chip">
                  {field.name}
                </span>
              ))}
            </span>
          ) : (
            <OutputSchemaDisclosure fields={analyzeOutputSchema} />
          ))}
      </header>
      <div className="step-preview__body">{body}</div>
    </section>
  );
}
