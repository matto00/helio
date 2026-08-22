// DateBucketConfig — field + granularity + optional output-column editor for
// the "datebucket" pipeline op (HEL-378 — see design.md decision 6).
//
// Field dropdown is sourced from the step's full inputSchema column list
// (unfiltered — mirrors CastFieldsConfig's field-source pattern, since
// datebucket accepts any scalar field rather than being restricted to a
// particular schema type like the string-body text ops). A fixed
// day/week/month/quarter/year granularity dropdown follows. The output-column
// text input is optional: left blank, the op overwrites the source field in
// place.

import type { ChangeEvent } from "react";

import { Select, TextField } from "../../../../shared/ui/index";
import { InlineError } from "../../../../shared/chrome/InlineError";

export const DATE_BUCKET_GRANULARITIES = ["day", "week", "month", "quarter", "year"] as const;

export type DateBucketGranularity = (typeof DATE_BUCKET_GRANULARITIES)[number];

const GRANULARITY_OPTIONS = DATE_BUCKET_GRANULARITIES.map((g) => ({ value: g, label: g }));

export interface DateBucketConfigValue {
  field: string;
  granularity: DateBucketGranularity;
  /** Empty string means "overwrite field in place" (no outputColumn). */
  outputColumn: string;
}

interface DateBucketConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: DateBucketConfigValue;
  /** Column names from the analyze endpoint's inputSchema for this step. */
  analyzeColumns: string[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: DateBucketConfigValue) => void;
}

export function DateBucketConfig({ config, analyzeColumns, onChange }: DateBucketConfigProps) {
  function handleFieldChange(field: string) {
    onChange({ ...config, field });
  }

  function handleGranularityChange(granularity: string) {
    const next = DATE_BUCKET_GRANULARITIES.includes(granularity as DateBucketGranularity)
      ? (granularity as DateBucketGranularity)
      : "day";
    onChange({ ...config, granularity: next });
  }

  function handleOutputColumnChange(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...config, outputColumn: e.target.value });
  }

  return (
    <div className="pipeline-detail-page__splittext-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Source field</span>
        <Select
          ariaLabel="Source field to bucket"
          value={config.field}
          placeholder="— select a field —"
          options={analyzeColumns.map((col) => ({ value: col, label: col }))}
          onChange={handleFieldChange}
        />
        {/* HEL sweep F-147: a required field with no validation lets an
         *  empty-named upstream schema field (or an unset config) silently
         *  propagate downstream as blank chips/messages. */}
        {config.field === "" && <InlineError error="Source field is required." />}
      </div>

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Granularity</span>
        <Select
          ariaLabel="Bucket granularity"
          value={config.granularity}
          options={GRANULARITY_OPTIONS}
          onChange={handleGranularityChange}
        />
      </div>

      <div className="pipeline-detail-page__compute-field">
        <label className="pipeline-detail-page__compute-label" htmlFor="datebucket-output-column">
          Output column (optional)
        </label>
        <TextField
          id="datebucket-output-column"
          placeholder="leave blank to overwrite source field"
          value={config.outputColumn}
          onChange={handleOutputColumnChange}
          aria-label="Output column"
        />
      </div>
    </div>
  );
}
