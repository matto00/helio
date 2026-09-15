// UpsertSourceConfig — target picker + append/replace mode toggle for the
// "upsertsource" pipeline op (HEL-1102 — see design.md Decisions 1-6).
//
// Reuses `sourcesSlice`/`fetchSources` (the same data-fetching path
// `SecondaryInputPicker` already uses for union/lookup) rather than a new
// Redux slice (Decision 1). The target radio choice starts with NEITHER
// option selected when the step's config has no `target` yet (Decision 3 —
// HEL-386/620 precedent against a synthesized default), and the mode
// `Select` gates a transition INTO `replace` behind `ConfirmInline`
// (Decision 5) rather than persisting it immediately.

import { useEffect, useId, useState } from "react";

import { fetchSources } from "../../../sources/state/sourcesSlice";
import { isStaticSource } from "../../../sources/types/dataSource";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { ConfirmInline, Select, TextField } from "../../../../shared/ui/index";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { isUnconfiguredUpsertTarget } from "../../state/stepNarrowing";
import type { UpsertMode, UpsertTarget } from "../../types/pipelineStep";

export interface UpsertSourceConfigValue {
  target?: UpsertTarget;
  mode: UpsertMode;
}

interface UpsertSourceConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: UpsertSourceConfigValue;
  /** design.md Decision 2 — true only for the pipeline's owner; a non-owner
   *  editor grantee cannot target an existing dataset (the backend's
   *  ownership check resolves the target against the PIPELINE OWNER, never
   *  the calling grantee). Threaded from `usePipelineDetailPage.ts`'s
   *  existing `isOwner` through `StepCard`/`StepOpEditor`. */
  isOwner: boolean;
  /** design.md Decision 6 — a rejected PATCH's backend message (cycle
   *  rejection, ownership "not found"), or `null`/absent when there is no
   *  outstanding save error. Sourced from `useStepCardState`'s new scoped
   *  `saveError` state, not the analyze-time `validationError` channel. */
  saveError?: string | null;
  /** Called with the typed config object on any committed change (CS2c-3a). */
  onChange: (newConfig: UpsertSourceConfigValue) => void;
}

export function UpsertSourceConfig({
  config,
  isOwner,
  saveError,
  onChange,
}: UpsertSourceConfigProps) {
  const dispatch = useAppDispatch();
  const { items: dataSources } = useAppSelector((state) => state.sources);

  // Each rendered card gets its own radio group name so multiple upsertsource
  // step cards on the same page don't share a browser-level radio group
  // (which would let selecting one card's option uncheck another card's).
  const radioGroupName = `upsertsource-target-kind-${useId()}`;

  useEffect(() => {
    void dispatch(fetchSources());
  }, [dispatch]);

  // design.md Decision 3 — a local choice distinct from "new-source" and
  // "existing-source": `undefined` means "no target chosen yet", matching
  // the backend's own incomplete-draft tolerance. Neither radio is checked
  // in that state, and neither sub-field is pre-populated.
  //
  // evaluation-1.md CR1: the backend's OWN round-trip of an incomplete draft is
  // `{kind:"existingSource", dataSourceId:""}` (`UpsertTarget.Default`), never a
  // truly-absent `target` -- `isUnconfiguredUpsertTarget` treats that sentinel
  // identically to `undefined` so a freshly-added, not-yet-persisted-choice step
  // never renders with "Use existing dataset" silently pre-checked once it round-trips
  // through the real backend.
  const initialChoice = isUnconfiguredUpsertTarget(config.target) ? undefined : config.target?.kind;
  const [choice, setChoice] = useState<UpsertTarget["kind"] | undefined>(initialChoice);
  const [prevTarget, setPrevTarget] = useState(config.target);
  if (prevTarget !== config.target) {
    setPrevTarget(config.target);
    setChoice(isUnconfiguredUpsertTarget(config.target) ? undefined : config.target?.kind);
  }

  // design.md Decision 5 — selecting `replace` in the mode Select updates
  // only this LOCAL pending flag and reveals `ConfirmInline`; the actual
  // `onChange` (and the visible committed selection) only happens on
  // Confirm. Selecting `append` (from any state) commits immediately —
  // append is never destructive.
  const [pendingReplace, setPendingReplace] = useState(false);

  const datasetOptions = dataSources.filter(isStaticSource).map((ds) => ({
    value: ds.id,
    label: ds.name,
  }));

  const newSourceName = config.target?.kind === "newSource" ? config.target.name : "";
  const existingDataSourceId =
    config.target?.kind === "existingSource" ? config.target.dataSourceId : "";

  function handleChoiceChange(kind: UpsertTarget["kind"]) {
    setChoice(kind);
    // Choosing a radio option alone doesn't yet produce a complete target
    // (a name/dataset still needs picking) — nothing is emitted here, only
    // the sub-field selection that follows.
  }

  function handleNewSourceNameChange(name: string) {
    onChange({ ...config, target: { kind: "newSource", name } });
  }

  function handleExistingDataSourceChange(dataSourceId: string) {
    onChange({ ...config, target: { kind: "existingSource", dataSourceId } });
  }

  function handleModeSelect(next: string) {
    const nextMode = next === "replace" ? "replace" : "append";
    if (nextMode === config.mode) return; // no redundant PATCH (matches every other change handler)
    if (nextMode === "replace") {
      setPendingReplace(true);
      return;
    }
    onChange({ ...config, mode: "append" });
  }

  function handleConfirmReplace() {
    setPendingReplace(false);
    onChange({ ...config, mode: "replace" });
  }

  function handleCancelReplace() {
    setPendingReplace(false);
  }

  return (
    <div className="pipeline-detail-page__upsertsource-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Target</span>
        <div
          className="pipeline-detail-page__upsertsource-radio-group"
          role="radiogroup"
          aria-label="Target"
        >
          <label
            className={`pipeline-detail-page__upsertsource-radio-option${!isOwner ? " pipeline-detail-page__upsertsource-radio-option--disabled" : ""}`}
          >
            <input
              type="radio"
              name={radioGroupName}
              checked={choice === "existingSource"}
              disabled={!isOwner}
              onChange={() => handleChoiceChange("existingSource")}
              aria-label="Use existing dataset"
            />
            Use existing dataset
          </label>
          <label className="pipeline-detail-page__upsertsource-radio-option">
            <input
              type="radio"
              name={radioGroupName}
              checked={choice === "newSource"}
              onChange={() => handleChoiceChange("newSource")}
              aria-label="Create new source"
            />
            Create new source
          </label>
        </div>
        {!isOwner && (
          <p className="pipeline-detail-page__upsertsource-radio-note">
            Only the pipeline owner can target an existing dataset — choose &quot;Create new
            source&quot; instead, or ask the owner to configure this step.
          </p>
        )}

        {choice === "existingSource" && isOwner && (
          <Select
            ariaLabel="Existing dataset"
            value={existingDataSourceId}
            placeholder="— select a dataset —"
            options={datasetOptions}
            onChange={handleExistingDataSourceChange}
          />
        )}

        {choice === "newSource" && (
          <TextField
            placeholder="e.g. enriched_users"
            value={newSourceName}
            onChange={(e) => handleNewSourceNameChange(e.target.value)}
            onBlur={(e) => handleNewSourceNameChange(e.target.value)}
            aria-label="New source name"
          />
        )}

        <InlineError error={saveError ?? null} />
      </div>

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Mode</span>
        <Select
          ariaLabel="Mode"
          value={config.mode}
          options={[
            { value: "append", label: "Append — add rows to the existing data" },
            { value: "replace", label: "Replace — overwrite the target entirely" },
          ]}
          onChange={handleModeSelect}
        />
        {pendingReplace && (
          <ConfirmInline
            label="Replace overwrites the target's existing data. This can't be undone."
            confirmLabel="Switch to replace"
            cancelLabel="Cancel"
            onConfirm={handleConfirmReplace}
            onCancel={handleCancelReplace}
          />
        )}
      </div>
    </div>
  );
}
