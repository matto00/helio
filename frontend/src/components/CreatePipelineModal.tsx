import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import "./CreatePipelineModal.css";
import { createPipeline, fetchPipelines } from "../features/pipelines/pipelinesSlice";
import { fetchSources } from "../features/sources/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";

interface CreatePipelineModalProps {
  onClose: () => void;
}

export function CreatePipelineModal({ onClose }: CreatePipelineModalProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const { items: dataSources, status: sourcesStatus } = useAppSelector((state) => state.sources);

  const [name, setName] = useState("");
  const [sourceDataSourceId, setSourceDataSourceId] = useState("");
  const [outputDataTypeName, setOutputDataTypeName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [outputTypeError, setOutputTypeError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    if (sourcesStatus === "idle") {
      void dispatch(fetchSources());
    }
  }, [dispatch, sourcesStatus]);

  function handleClose() {
    dialogRef.current?.close();
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    // Validate fields
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
      handleClose();
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

  return (
    <dialog
      ref={dialogRef}
      className="create-pipeline-modal"
      aria-label="Create pipeline"
      onClose={onClose}
    >
      <div className="create-pipeline-modal__inner">
        <header className="create-pipeline-modal__header">
          <h2 className="create-pipeline-modal__title">Create pipeline</h2>
          <button
            type="button"
            className="create-pipeline-modal__close"
            aria-label="Close modal"
            onClick={handleClose}
          >
            ✕
          </button>
        </header>

        <form className="create-pipeline-modal__form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="create-pipeline-modal__field">
            <label className="create-pipeline-modal__label" htmlFor="pipeline-name">
              Pipeline name
            </label>
            <input
              id="pipeline-name"
              type="text"
              className="create-pipeline-modal__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sales ETL"
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
            <select
              id="pipeline-source"
              className="create-pipeline-modal__select"
              value={sourceDataSourceId}
              onChange={(e) => setSourceDataSourceId(e.target.value)}
            >
              <option value="">Select a data source…</option>
              {dataSources.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name}
                </option>
              ))}
            </select>
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
            <input
              id="pipeline-output-type"
              type="text"
              className="create-pipeline-modal__input"
              value={outputDataTypeName}
              onChange={(e) => setOutputDataTypeName(e.target.value)}
              placeholder="e.g. SalesMetrics"
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

          <div className="create-pipeline-modal__actions">
            <button
              type="button"
              className="create-pipeline-modal__btn create-pipeline-modal__btn--secondary"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="create-pipeline-modal__btn create-pipeline-modal__btn--primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating…" : "Create pipeline"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
