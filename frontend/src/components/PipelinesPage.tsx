import { useEffect, useState } from "react";

import "./PipelinesPage.css";
import { fetchPipelines } from "../features/pipelines/pipelinesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { CreatePipelineModal } from "./CreatePipelineModal";
import { PipelineEmptyState } from "./PipelineEmptyState";
import { PipelineListTable } from "./PipelineListTable";

export function PipelinesPage() {
  const dispatch = useAppDispatch();
  const { items, status, error } = useAppSelector((state) => state.pipelines);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    void dispatch(fetchPipelines());
  }, [dispatch]);

  function handleOpenModal() {
    setIsModalOpen(true);
  }

  function handleCloseModal() {
    setIsModalOpen(false);
  }

  return (
    <div className="pipelines-page">
      <div className="pipelines-page__section">
        <div className="pipelines-page__section-header">
          <h2 className="pipelines-page__section-title">Data Pipelines</h2>
        </div>

        {status === "loading" && <p className="pipelines-page__loading">Loading pipelines…</p>}

        {status === "failed" && error && (
          <p className="pipelines-page__error" role="alert">
            {error}
          </p>
        )}

        {(status === "succeeded" || status === "idle") && items.length === 0 && (
          <PipelineEmptyState onCreateClick={handleOpenModal} />
        )}

        {status === "succeeded" && items.length > 0 && (
          <>
            <div className="pipelines-page__toolbar">
              <button
                type="button"
                className="pipelines-page__create-btn"
                onClick={handleOpenModal}
              >
                Create pipeline
              </button>
            </div>
            <PipelineListTable pipelines={items} />
          </>
        )}
      </div>

      {isModalOpen && <CreatePipelineModal onClose={handleCloseModal} />}
    </div>
  );
}
