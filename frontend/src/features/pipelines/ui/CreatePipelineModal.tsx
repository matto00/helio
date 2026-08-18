import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { createPipeline } from "../state/pipelinesSlice";
import { fetchSources } from "../../sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { Modal } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { labelForKind } from "../../sources/utils/labelForKind";
import "./CreatePipelineModal.css";

interface CreatePipelineModalProps {
  onClose: () => void;
}

export function CreatePipelineModal({ onClose }: CreatePipelineModalProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const { items: dataSources, status: sourcesStatus } = useAppSelector((state) => state.sources);
  // F-041: gated on a resolved fetch — while loading, `dataSources` is legitimately still empty
  // and hasn't failed yet, so showing "no sources yet" would be a false read.
  const noSourcesYet = sourcesStatus === "succeeded" && dataSources.length === 0;

  const [name, setName] = useState("");
  const [sourceDataSourceId, setSourceDataSourceId] = useState("");
  const [outputDataTypeName, setOutputDataTypeName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [outputTypeError, setOutputTypeError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Always refetch on mount — modal is opened infrequently and the list must
  // include sources added since the last navigation to /sources.
  useEffect(() => {
    void dispatch(fetchSources());
  }, [dispatch]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    let hasError = false;
    if (!name.trim()) {
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
    if (!outputDataTypeName.trim()) {
      setOutputTypeError("Output type name is required.");
      hasError = true;
    } else {
      setOutputTypeError(null);
    }

    if (hasError) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await dispatch(
        createPipeline({
          name: name.trim(),
          sourceDataSourceId,
          outputDataTypeName: outputDataTypeName.trim(),
        }),
      ).unwrap();

      // F-104 — `createPipeline.fulfilled` (pipelinesSlice.ts) already pushes
      // the new pipeline into `state.items` directly; a follow-up
      // `fetchPipelines()` here would just re-request the whole list (and,
      // once `fetchPipelines`'s dedupe `condition` treats an already-loaded
      // list as "nothing to do", silently no-op instead).
      onClose();
      void navigate(`/pipelines/${result.id}`);
    } catch (err: unknown) {
      const msg =
        typeof err === "string" && err
          ? err
          : err instanceof Error
            ? err.message
            : "Failed to create pipeline.";
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  // F-224: include the source's kind so identically-named sources (a common
  // occurrence after repeated test/renamed sources) are distinguishable, and
  // rely on Select's own `placeholder` for the unselected state rather than
  // injecting a disabled placeholder option into the list (redundant with
  // the trigger's placeholder text, and previously showed up as a selectable
  // list entry).
  const sourceOptions = dataSources.map((ds) => ({
    value: ds.id,
    label: `${ds.name} (${labelForKind(ds.type)})`,
  }));

  const footer = (
    <>
      <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={onClose}>
        Cancel
      </button>
      <button
        type="submit"
        form="create-pipeline-form"
        className="ui-modal-btn ui-modal-btn--primary"
        disabled={isSubmitting || noSourcesYet}
      >
        {isSubmitting ? "Creating…" : "Create pipeline"}
      </button>
    </>
  );

  return (
    <Modal
      open
      title="Create pipeline"
      // F-161: sm tracks this form's content — 3 short fields, no reason to
      // reserve more width. Not meant to match every other "create X" modal;
      // each one's size should track its own field set (see CreateMetricModal.tsx).
      size="sm"
      ariaLabel="Create pipeline"
      onClose={onClose}
      footer={footer}
    >
      <form
        id="create-pipeline-form"
        className="create-pipeline-modal__form"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="create-pipeline-modal__field">
          <label className="create-pipeline-modal__label" htmlFor="pipeline-name">
            Pipeline name
          </label>
          <TextField
            id="pipeline-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales ETL"
            aria-label="Pipeline name"
          />
          {nameError && (
            <p className="create-pipeline-modal__field-error" role="alert">
              {nameError}
            </p>
          )}
        </div>

        <div className="create-pipeline-modal__field">
          <label className="create-pipeline-modal__label" htmlFor="pipeline-source">
            Data source
          </label>
          {noSourcesYet ? (
            // F-041: a pipeline can't be created against zero sources — say so plainly and link
            // straight to where one gets added, instead of leaving an empty picker + a generic
            // "required" error as the only feedback once Create is clicked.
            <p className="create-pipeline-modal__field-notice">
              No data sources yet.{" "}
              <Link to="/sources" onClick={onClose}>
                Add one first
              </Link>
              .
            </p>
          ) : (
            <Select
              value={sourceDataSourceId}
              options={sourceOptions}
              onChange={setSourceDataSourceId}
              placeholder="Select a data source…"
              ariaLabel="Data source"
            />
          )}
          {sourceError && (
            <p className="create-pipeline-modal__field-error" role="alert">
              {sourceError}
            </p>
          )}
        </div>

        <div className="create-pipeline-modal__field">
          <label className="create-pipeline-modal__label" htmlFor="pipeline-output-type">
            Output type name
          </label>
          <TextField
            id="pipeline-output-type"
            value={outputDataTypeName}
            onChange={(e) => setOutputDataTypeName(e.target.value)}
            placeholder="e.g. SalesMetrics"
            aria-label="Output type name"
          />
          {outputTypeError && (
            <p className="create-pipeline-modal__field-error" role="alert">
              {outputTypeError}
            </p>
          )}
        </div>

        {submitError && (
          <p className="create-pipeline-modal__error" role="alert">
            {submitError}
          </p>
        )}
      </form>
    </Modal>
  );
}
