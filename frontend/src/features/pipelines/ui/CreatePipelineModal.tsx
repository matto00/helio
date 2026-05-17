import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { createPipeline, fetchPipelines } from "../state/pipelinesSlice";
import { fetchSources } from "../../sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { Modal } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import "./CreatePipelineModal.css";

interface CreatePipelineModalProps {
  onClose: () => void;
}

export function CreatePipelineModal({ onClose }: CreatePipelineModalProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const { items: dataSources } = useAppSelector((state) => state.sources);

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

      void dispatch(fetchPipelines());
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

  const sourceOptions = dataSources.map((ds) => ({ value: ds.id, label: ds.name }));

  const footer = (
    <>
      <button type="button" className="ui-modal-btn ui-modal-btn--secondary" onClick={onClose}>
        Cancel
      </button>
      <button
        type="submit"
        form="create-pipeline-form"
        className="ui-modal-btn ui-modal-btn--primary"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Creating…" : "Create pipeline"}
      </button>
    </>
  );

  return (
    <Modal
      open
      title="Create pipeline"
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
