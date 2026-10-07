// HEL-1331 -- the Output editor's History section: the "Keep each run's rows" switch
// (`config.historyPayloads`), the cap/retention copy, and the disabled-with-upsell state.
// Availability comes ONLY from the Output response's `historyPayloadsAvailable` (the pipeline
// owner's tier), never the viewer's own tier.

import { Link } from "react-router-dom";

import { Toggle } from "../../../../shared/ui/index";

const HELP_ID = "output-history-payloads-help";
const NOTE_ID = "output-history-payloads-note";

// The numbers mirror the backend defaults (`PayloadHistoryConfig.Defaults`: 1000 rows, 1 MiB,
// beta 10 runs / 7 days, owner 30 runs / 30 days). An env override would make this copy stale.
const HELP_TEXT =
  "Stores the full rows of every run from the next run on, so History can show what changed. A run over 1,000 rows or 1 MiB keeps only its summary. Beta keeps the last 10 runs for 7 days; Owner keeps 30 runs for 30 days.";
const OPT_OUT_TEXT =
  "Turning this off stops storing rows; rows already kept expire on the normal schedule.";
const UNAVAILABLE_NOTE = "Free stores run summaries only";

interface HistoryPayloadsFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The Output's `historyPayloadsAvailable === true`. */
  available: boolean;
}

export function HistoryPayloadsField({ checked, onChange, available }: HistoryPayloadsFieldProps) {
  return (
    <div className="output-editor-sheet__data-section">
      <Toggle
        label="Keep each run's rows"
        checked={checked}
        onChange={onChange}
        disabled={!available}
        ariaDescribedBy={available ? HELP_ID : `${HELP_ID} ${NOTE_ID}`}
      />
      <p id={HELP_ID} className="output-editor-sheet__field-hint">
        {HELP_TEXT} {OPT_OUT_TEXT}
      </p>
      {!available && (
        <p id={NOTE_ID} className="output-editor-sheet__type-hint">
          <span>{UNAVAILABLE_NOTE}</span>{" "}
          <Link className="output-editor-sheet__upsell-link" to="/settings#beta-access">
            Request Beta access
          </Link>
        </p>
      )}
    </div>
  );
}
