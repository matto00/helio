import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import "./PipelinesPage.css";
import { fetchPipelines } from "../services/pipelineService";
import type { Pipeline } from "../types/models";

export function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [status, setStatus] = useState<"loading" | "succeeded" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    fetchPipelines()
      .then((items) => {
        if (!cancelled) {
          setPipelines(items);
          setStatus("succeeded");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="pipelines-page">
      <div className="pipelines-page__header">
        <h2 className="pipelines-page__title">Data Pipelines</h2>
      </div>

      {status === "loading" && <p className="pipelines-page__loading">Loading pipelines…</p>}
      {status === "failed" && (
        <p className="pipelines-page__error" role="alert">
          Failed to load pipelines.
        </p>
      )}

      {status === "succeeded" && (
        <ul className="pipelines-page__list">
          {pipelines.length === 0 && <li className="pipelines-page__empty">No pipelines yet.</li>}
          {pipelines.map((pipeline) => (
            <li key={pipeline.id} className="pipelines-page__item">
              <Link to={`/pipelines/${pipeline.id}`} className="pipelines-page__item-link">
                <span className="pipelines-page__item-name">{pipeline.name}</span>
                <span className="pipelines-page__item-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
