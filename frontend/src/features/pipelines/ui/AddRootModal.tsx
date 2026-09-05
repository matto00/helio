// AddRootModal — HEL-968 task 8 ("+ root", design.md D4). Mirrors
// `CreatePipelineModal`'s inline-source composition (an existing-source
// `Select` plus a nested `AddSourceModal` "Create a new source" path) --
// paste-table/static, CSV upload or URL, REST connector, or text/markdown
// upload or URL are all reachable without leaving this flow.

import { useEffect, useState } from "react";

import { fetchSources } from "../../sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { Modal } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { labelForKind } from "../../sources/utils/labelForKind";
import { AddSourceModal } from "../../sources/ui/AddSourceModal";

interface AddRootModalProps {
  onClose: () => void;
  /** D4 — the handler owns its own second refusal-on-unset-id guard; this
   *  callback is only ever invoked with a real, non-empty source id. */
  onAdd: (sourceId: string) => void;
}

export function AddRootModal({ onClose, onAdd }: AddRootModalProps) {
  const dispatch = useAppDispatch();
  const { items: dataSources, status: sourcesStatus } = useAppSelector((state) => state.sources);
  const noSourcesYet = sourcesStatus === "succeeded" && dataSources.length === 0;

  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);

  useEffect(() => {
    void dispatch(fetchSources());
  }, [dispatch]);

  function handleSourceCreated(createdSourceId: string) {
    setSelectedSourceId(createdSourceId);
    setSourceError(null);
  }

  function handleSubmit() {
    // D4 — the second guard: the confirm control below is ALSO disabled on
    // an unset id (HEL-620 was exactly a picker defaulting to an unset id
    // and issuing a request that 404'd on the ACL check), so this refusal
    // only fires against a race/programmatic call, never a normal click.
    if (!selectedSourceId) {
      setSourceError("A data source is required.");
      return;
    }
    onAdd(selectedSourceId);
  }

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
        type="button"
        className="ui-modal-btn ui-modal-btn--primary"
        disabled={!selectedSourceId}
        onClick={handleSubmit}
      >
        Add root
      </button>
    </>
  );

  return (
    <>
      <Modal
        open
        title="Add a root"
        size="sm"
        ariaLabel="Add a root"
        onClose={onClose}
        footer={footer}
      >
        <div className="create-pipeline-modal__field">
          <label className="create-pipeline-modal__label" htmlFor="add-root-source">
            Data source
          </label>
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
      </Modal>

      {addSourceOpen && (
        <AddSourceModal onClose={() => setAddSourceOpen(false)} onCreated={handleSourceCreated} />
      )}
    </>
  );
}
