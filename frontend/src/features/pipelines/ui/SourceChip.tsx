// Source chip shown in the PipelineDetailPage source-selector bar. Each chip
// represents one DataSource the user may include/exclude from the pipeline,
// with a small mock preview table available on toggle.

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTable } from "@fortawesome/free-solid-svg-icons";

import type { DataSource } from "../../../types/models";

interface SourceChipProps {
  source: DataSource;
}

export function SourceChip({ source }: SourceChipProps) {
  const [active, setActive] = useState(true);
  const [previewing, setPreviewing] = useState(false);

  const mockRows = [
    ["id", "name", "value"],
    ["1", "Alpha", "42"],
    ["2", "Beta", "91"],
    ["3", "Gamma", "17"],
  ];

  return (
    <div className="pipeline-detail-page__source-chip-wrapper">
      <div
        className={`pipeline-detail-page__source-chip${active ? " pipeline-detail-page__source-chip--active" : ""}`}
      >
        <button
          type="button"
          className="pipeline-detail-page__source-chip-toggle"
          onClick={() => setActive((v) => !v)}
          aria-pressed={active}
        >
          <span className="pipeline-detail-page__source-chip-name">{source.name}</span>
          <span className="pipeline-detail-page__source-chip-count">—</span>
        </button>
        <button
          type="button"
          className="pipeline-detail-page__source-chip-preview-btn"
          onClick={() => setPreviewing((v) => !v)}
          aria-label={`Preview ${source.name}`}
          aria-pressed={previewing}
          title="Preview data"
        >
          <FontAwesomeIcon icon={faTable} />
        </button>
      </div>

      {previewing && active && (
        <div className="pipeline-detail-page__source-preview">
          <table className="pipeline-detail-page__source-preview-table">
            <thead>
              <tr>
                {mockRows[0].map((col) => (
                  <th key={col} className="pipeline-detail-page__source-preview-th">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mockRows.slice(1).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="pipeline-detail-page__source-preview-td">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
