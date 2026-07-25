// ShapeInstantiateStep — "start from a shape" instantiation step of
// PanelCreationModal (HEL-399). Reached from DataTypeSelectStep after
// selecting a shape card. Collects a pipeline name, an output type name
// (same required-field validation as `CreatePipelineModal`), a data source,
// and the shape's params form (shared `ShapeParamsFields`, HEL-402/HEL-399
// design.md Decision 6), then composes the same five-endpoint chain
// `ShapePickerModal` (in-editor) and the MCP `createPipelineFromShape` tool
// already use client-side (design.md Decision 1 — no new backend endpoint):
//
//   buildShapeParams → expand → createPipeline → createPipelineStep* → run
//
// Every pre-run failure (`buildShapeParams` field error, expand/create/
// addStep) is shown inline, verbatim, and stops the chain — no rollback, no
// automatic retry, no silent failure (the direct design-against for the
// HEL-336 lookup-picker defect: an empty/default-param POST failing silently
// with no user-visible feedback). A run failure alone offers "Retry run",
// which re-POSTs only `/run` for the already-created pipeline (design.md
// Decision 5).
//
// On success, only `dataTypeId` is returned to the caller — `fieldMapping`
// is never set here, matching the existing DataType-select step exactly
// (design.md Decision 3).

import { useEffect, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";

import { fetchSources } from "../../../sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { Select } from "../../../../shared/ui/Select";
import { TextField } from "../../../../shared/ui/TextField";
import { InlineError } from "../../../../shared/chrome/InlineError";
import {
  createPipeline,
  createPipelineStep,
  expandPipelineShape,
  runPipeline,
} from "../../../pipelines/services/pipelineService";
import { buildShapeParams, ShapeParamsFields } from "../../../pipelines/ui/ShapeParamsFields";
import type { PipelineShapeCatalogEntry } from "../../../pipelines/types/pipelineShape";

import "./ShapeInstantiateStep.css";

interface ShapeInstantiateStepProps {
  shape: PipelineShapeCatalogEntry;
  onBack: () => void;
  /** Called once `run` succeeds. The caller sets `dataTypeId` from this and
   *  advances to name-entry — see design.md Decision 3 (no `fieldMapping`). */
  onComplete: (result: { dataTypeId: string; pipelineId: string }) => void;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

type Stage = "expand" | "create" | "steps" | "run";

const STAGE_LABEL: Record<Stage, string> = {
  expand: "Validating shape…",
  create: "Creating pipeline…",
  steps: "Adding steps…",
  run: "Running…",
};

export function ShapeInstantiateStep({ shape, onBack, onComplete }: ShapeInstantiateStepProps) {
  const dispatch = useAppDispatch();
  const { items: dataSources } = useAppSelector((state) => state.sources);

  const [pipelineName, setPipelineName] = useState("");
  const [outputTypeName, setOutputTypeName] = useState("");
  const [sourceDataSourceId, setSourceDataSourceId] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const [nameError, setNameError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [outputTypeError, setOutputTypeError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Retry-run state: once a pipeline is created and steps are added, a run
  // failure can retry `run` alone without redoing the earlier stages.
  const [runFailedPipelineId, setRunFailedPipelineId] = useState<string | null>(null);
  const [runFailedDataTypeId, setRunFailedDataTypeId] = useState<string | null>(null);

  // Always refetch on mount, mirroring `CreatePipelineModal` — this step is
  // reached infrequently and the source list must include anything added
  // since the last visit to /sources.
  useEffect(() => {
    void dispatch(fetchSources());
  }, [dispatch]);

  function setParam(name: string, value: string) {
    setParamValues((prev) => ({ ...prev, [name]: value }));
  }

  const requiredParamsFilled = shape.paramsSchema
    .filter((p) => p.required)
    .every((p) => (paramValues[p.name] ?? "").trim() !== "");

  const canSubmit =
    pipelineName.trim() !== "" &&
    outputTypeName.trim() !== "" &&
    sourceDataSourceId !== "" &&
    requiredParamsFilled;

  async function runOnly(pipelineId: string, dataTypeId: string) {
    setStage("run");
    try {
      await runPipeline(pipelineId);
      setRunFailedPipelineId(null);
      setRunFailedDataTypeId(null);
      onComplete({ dataTypeId, pipelineId });
    } catch (err: unknown) {
      setSubmitError(extractErrorMessage(err, "Failed to run pipeline."));
      setRunFailedPipelineId(pipelineId);
      setRunFailedDataTypeId(dataTypeId);
    } finally {
      setStage(null);
      setIsSubmitting(false);
    }
  }

  async function handleRetryRun() {
    if (!runFailedPipelineId || !runFailedDataTypeId || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    await runOnly(runFailedPipelineId, runFailedDataTypeId);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    let hasError = false;
    if (!pipelineName.trim()) {
      setNameError("Pipeline name is required.");
      hasError = true;
    } else {
      setNameError(null);
    }
    if (!sourceDataSourceId) {
      setSourceError("Data source is required.");
      hasError = true;
    } else {
      setSourceError(null);
    }
    if (!outputTypeName.trim()) {
      setOutputTypeError("Output type name is required.");
      hasError = true;
    } else {
      setOutputTypeError(null);
    }
    if (hasError) return;

    const built = buildShapeParams(shape.paramsSchema, paramValues);
    if ("fieldError" in built) {
      setSubmitError(built.fieldError);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setRunFailedPipelineId(null);
    setRunFailedDataTypeId(null);

    // Stage 1: expand. A 422/404 here creates nothing — the error is the
    // shape's own validation message, shown verbatim (HEL-336 defect guard).
    setStage("expand");
    let expansions;
    try {
      expansions = await expandPipelineShape(shape.id, built.params);
    } catch (err: unknown) {
      setSubmitError(extractErrorMessage(err, "Failed to expand shape."));
      setStage(null);
      setIsSubmitting(false);
      return;
    }

    // Stage 2: create the pipeline (and its output DataType, server-side).
    setStage("create");
    let pipelineId: string;
    let dataTypeId: string;
    try {
      const summary = await createPipeline({
        name: pipelineName.trim(),
        sourceDataSourceId,
        outputDataTypeName: outputTypeName.trim(),
      });
      if (!summary.outputDataTypeId) {
        setSubmitError("Pipeline was created without an output data type.");
        setStage(null);
        setIsSubmitting(false);
        return;
      }
      pipelineId = summary.id;
      dataTypeId = summary.outputDataTypeId;
    } catch (err: unknown) {
      setSubmitError(extractErrorMessage(err, "Failed to create pipeline."));
      setStage(null);
      setIsSubmitting(false);
      return;
    }

    // Stage 3: add each expanded step, in order. No rollback of the already-
    // created pipeline on a mid-loop failure (design.md Decision 5) — it's
    // discoverable and fixable from /pipelines like any other pipeline.
    setStage("steps");
    for (const expansion of expansions) {
      try {
        await createPipelineStep(pipelineId, expansion.kind, expansion.config);
      } catch (err: unknown) {
        setSubmitError(extractErrorMessage(err, "Failed to add a pipeline step."));
        setStage(null);
        setIsSubmitting(false);
        return;
      }
    }

    // Stage 4: run. Only a run failure gets the "Retry run" affordance.
    await runOnly(pipelineId, dataTypeId);
  }

  const sourceOptions = dataSources.map((ds) => ({ value: ds.id, label: ds.name }));
  const statusLabel = stage ? STAGE_LABEL[stage] : null;

  return (
    <div className="shape-instantiate-step">
      <form
        id="shape-instantiate-form"
        className="shape-instantiate-step__form"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="shape-instantiate-step__field">
          <label className="shape-instantiate-step__label" htmlFor="shape-instantiate-name">
            Pipeline name
          </label>
          <TextField
            id="shape-instantiate-name"
            value={pipelineName}
            onChange={(e) => setPipelineName(e.target.value)}
            placeholder="e.g. Sales ETL"
            aria-label="Pipeline name"
          />
          <InlineError error={nameError} />
        </div>

        <div className="shape-instantiate-step__field">
          <label className="shape-instantiate-step__label" htmlFor="shape-instantiate-source">
            Data source
          </label>
          <Select
            value={sourceDataSourceId}
            options={[
              { value: "", label: "Select a data source…", disabled: true },
              ...sourceOptions,
            ]}
            onChange={setSourceDataSourceId}
            placeholder="Select a data source…"
            ariaLabel="Data source"
          />
          <InlineError error={sourceError} />
        </div>

        <div className="shape-instantiate-step__field">
          <label className="shape-instantiate-step__label" htmlFor="shape-instantiate-output-type">
            Output type name
          </label>
          <TextField
            id="shape-instantiate-output-type"
            value={outputTypeName}
            onChange={(e) => setOutputTypeName(e.target.value)}
            placeholder="e.g. SalesMetrics"
            aria-label="Output type name"
          />
          <InlineError error={outputTypeError} />
        </div>

        <ShapeParamsFields
          paramsSchema={shape.paramsSchema}
          values={paramValues}
          onChange={setParam}
          idPrefix="shape-instantiate-param"
        />

        {statusLabel && <p className="shape-instantiate-step__status">{statusLabel}</p>}
        <InlineError error={submitError} />

        {runFailedPipelineId && (
          <button
            type="button"
            className="panel-creation-modal__btn panel-creation-modal__btn--secondary"
            onClick={() => void handleRetryRun()}
            disabled={isSubmitting}
          >
            Retry run
          </button>
        )}
      </form>

      <div className="panel-creation-modal__actions">
        <button
          type="button"
          className="panel-creation-modal__btn panel-creation-modal__btn--secondary"
          onClick={onBack}
          disabled={isSubmitting}
        >
          Back
        </button>
        <button
          type="submit"
          form="shape-instantiate-form"
          className="panel-creation-modal__btn panel-creation-modal__btn--primary"
          disabled={!canSubmit || isSubmitting}
        >
          {isSubmitting ? (statusLabel ?? "Working…") : "Create and bind"}
        </button>
      </div>
    </div>
  );
}
