// UnionConfig — other-source picker + byPosition/byName mode toggle for the
// "union" pipeline op (HEL-384 — see design.md Decisions 2-4, 7).
//
// The other-source picker is sourced from the sources feature's redux slice
// (mirrors CreatePipelineModal's data-source Select pattern) rather than
// `analyzeColumns`/`analyzeSchema` — union's second operand is a whole
// DataSource, not a column of the current step's input. The mode toggle
// reuses the filter-combinator button recipe (see DedupeConfig's keep
// first/last toggle) since it's the same binary-choice UI shape.

import { useEffect } from "react";

import { fetchSources } from "../../../sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { Select } from "../../../../shared/ui/index";
import type { UnionMode } from "../../types/pipelineStep";

export interface UnionConfigValue {
  otherDataSourceId: string;
  mode: UnionMode;
}

interface UnionConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: UnionConfigValue;
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: UnionConfigValue) => void;
}

export function UnionConfig({ config, onChange }: UnionConfigProps) {
  const dispatch = useAppDispatch();
  const { items: dataSources } = useAppSelector((state) => state.sources);

  // Always refetch on mount — the picker must include sources added since
  // the last navigation to /sources (mirrors CreatePipelineModal).
  useEffect(() => {
    void dispatch(fetchSources());
  }, [dispatch]);

  function handleOtherSourceChange(otherDataSourceId: string) {
    onChange({ ...config, otherDataSourceId });
  }

  function handleModeChange(mode: UnionMode) {
    onChange({ ...config, mode });
  }

  const sourceOptions = dataSources.map((ds) => ({ value: ds.id, label: ds.name }));

  return (
    <div className="pipeline-detail-page__union-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Other data source</span>
        <Select
          ariaLabel="Other data source"
          value={config.otherDataSourceId}
          placeholder="— select a data source —"
          options={sourceOptions}
          onChange={handleOtherSourceChange}
        />
      </div>

      <div className="pipeline-detail-page__filter-combinator">
        <span className="pipeline-detail-page__filter-combinator-label">Mode</span>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.mode === "byPosition" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleModeChange("byPosition")}
          aria-pressed={config.mode === "byPosition"}
        >
          BY POSITION
        </button>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.mode === "byName" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleModeChange("byName")}
          aria-pressed={config.mode === "byName"}
        >
          BY NAME
        </button>
      </div>
      <p className="pipeline-detail-page__aggregate-section-description">
        {config.mode === "byPosition"
          ? "Rows are appended as-is; both sources should share the same columns."
          : "Rows are aligned by column name; a column missing on either side is filled with null."}
      </p>
    </div>
  );
}
