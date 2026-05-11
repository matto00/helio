import { useEffect } from "react";

import "./PipelinesPage.css";
import { fetchPipelines, setCreatePipelineModalOpen } from "../features/pipelines/pipelinesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { CreatePipelineModal } from "./CreatePipelineModal";
import { PipelineEmptyState } from "./PipelineEmptyState";
import { PipelineListTable } from "./PipelineListTable";

export function PipelinesPage() {
  const dispatch = useAppDispatch();
  const { items, status, error, createModalOpen } = useAppSelector((state) => state.pipelines);

  useEffect(() => {
    void dispatch(fetchPipelines());
  }, [dispatch]);

  return (
    <div className="pipelines-page">
      <div className="pipelines-page__section">
        {status === "loading" && <p className="pipelines-page__loading">Loading pipelines…</p>}

        {status === "failed" && error && (
          <p className="pipelines-page__error" role="alert">
            {error}
          </p>
        )}

        {(status === "succeeded" || status === "idle") && items.length === 0 && (
          <PipelineEmptyState onCreateClick={() => dispatch(setCreatePipelineModalOpen(true))} />
        )}

        {status === "succeeded" && items.length > 0 && <PipelineListTable pipelines={items} />}
      </div>

      {createModalOpen && (
        <CreatePipelineModal onClose={() => dispatch(setCreatePipelineModalOpen(false))} />
      )}
    </div>
  );
}
