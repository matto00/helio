import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { createPipeline } from "../state/pipelinesSlice";
import { fetchSources } from "../../sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { Modal } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { labelForKind } from "../../sources/utils/labelForKind";
import { AddSourceModal } from "../../sources/ui/AddSourceModal";
import "./CreatePipelineModal.css";

interface CreatePipelineModalProps {
  onClose: () => void;
}

/** HEL-908 task 7.1/7.3 — "New pipeline" entry: pick an existing source, or
 *  create a brand-new one (any kind `AddSourceModal` supports — paste-table/
 *  static, CSV upload or URL, REST connector, or text/markdown upload or
 *  URL) inline, then a single `POST /api/pipelines` with just
 *  `{name, roots: [{sourceId}]}` — a one-element array, since this flow
 *  still authors exactly one source (HEL-969; HEL-913 replaced the scalar
 *  request field with a non-empty `roots[]`). `steps`/
 *  `outputs` default to empty, so a brand-new pipeline lands with zero steps
 *  — its raw source is what `usePipelineDetailPage`'s unconditional
 *  mount-time `analyzePipeline` call already previews, satisfying "land on
 *  the page with root previewed" for free). The retired "Output type name"
 *  field (DataType-bound, HEL-903 dropped that concept) is gone.
 *
 *  "Create a new source" nests `AddSourceModal` (the same component
 *  `/sources` uses) rather than re-implementing per-kind source-creation
 *  forms here — `AddSourceModal`'s new `onCreated` callback (added this
 *  cycle) reports the created source's id back into `selectedSourceId`
 *  (local state — becomes `roots[0].sourceId` in the POST body)
 *  once it closes, so this modal stays open with that source pre-selected
 *  and the pipeline-name field intact, ready to submit. */
export function CreatePipelineModal({ onClose }: CreatePipelineModalProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const { items: dataSources, status: sourcesStatus } = useAppSelector((state) => state.sources);
  // F-041: gated on a resolved fetch — while loading, `dataSources` is legitimately still empty
  // and hasn't failed yet, so showing "no sources yet" would be a false read.
  const noSourcesYet = sourcesStatus === "succeeded" && dataSources.length === 0;

  const [name, setName] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addSourceOpen, setAddSourceOpen] = useState(false);

  // Always refetch on mount — modal is opened infrequently and the list must
  // include sources added since the last navigation to /sources.
  useEffect(() => {
    void dispatch(fetchSources());
  }, [dispatch]);

  function handleSourceCreated(createdSourceId: string) {
    setSelectedSourceId(createdSourceId);
    setSourceError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    let hasError = false;
    if (!name.trim()) {
      setNameError("Pipeline name is required.");
      hasError = true;
    } else {
      setNameError(null);
    }
    if (!selectedSourceId) {
      setSourceError("Data source is required.");
      hasError = true;
    } else {
      setSourceError(null);
    }

    if (hasError) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await dispatch(
        createPipeline({
          name: name.trim(),
          roots: [{ sourceId: selectedSourceId }],
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
        disabled={isSubmitting}
      >
        {isSubmitting ? "Creating…" : "Create pipeline"}
      </button>
    </>
  );

  return (
    <>
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
            {/* HEL-908 task 7.1 — a source can be picked from the existing
             * list OR created fresh (any kind — paste-table/CSV/URL/REST/
             * markdown, via the nested AddSourceModal) without leaving this
             * modal. `noSourcesYet` used to hard-block the form with a "go
             * add one first" link; now it just means the picker starts
             * empty — "Create a new source" is always available. */}
            {!noSourcesYet && (
              <Select
                value={selectedSourceId}
                options={sourceOptions}
                onChange={setSelectedSourceId}
                placeholder="Select a data source…"
                ariaLabel="Data source"
              />
            )}
            <button
              type="button"
              className="create-pipeline-modal__add-source-btn"
              onClick={() => setAddSourceOpen(true)}
            >
              {selectedSourceId ? "Create a different source" : "Create a new source"}
            </button>
            {selectedSourceId && (
              <p className="create-pipeline-modal__field-notice">
                Using{" "}
                {sourceOptions.find((o) => o.value === selectedSourceId)?.label ??
                  "the newly created source"}
                .
              </p>
            )}
            {sourceError && (
              <p className="create-pipeline-modal__field-error" role="alert">
                {sourceError}
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

      {addSourceOpen && (
        <AddSourceModal onClose={() => setAddSourceOpen(false)} onCreated={handleSourceCreated} />
      )}
    </>
  );
}
