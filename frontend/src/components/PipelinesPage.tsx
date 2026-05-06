import { useEffect } from "react";

import "./PipelinesPage.css";
import { fetchPipelines } from "../features/pipelines/pipelinesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { PipelineEmptyState } from "./PipelineEmptyState";
import { PipelineListTable } from "./PipelineListTable";

export function PipelinesPage() {
  const dispatch = useAppDispatch();
  const { items, status, error } = useAppSelector((state) => state.pipelines);

  useEffect(() => {
    void dispatch(fetchPipelines());
  }, [dispatch]);

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
          <PipelineEmptyState />
        )}

        {status === "succeeded" && items.length > 0 && <PipelineListTable pipelines={items} />}
      </div>
    </div>
  );
}
