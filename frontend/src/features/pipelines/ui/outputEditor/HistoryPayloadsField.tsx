// HEL-1331 -- the Output editor's History section: the "Keep each run's rows" switch
// (`config.historyPayloads`), the cap/retention copy, and the disabled-with-upsell state.
// Availability comes ONLY from the Output response's `historyPayloadsAvailable` (the pipeline
// owner's tier), never the viewer's own tier.

import { Link } from "react-router-dom";

import { Toggle } from "../../../../shared/ui/index";
import type { HistoryPayloadLimits } from "../../types/output";
import { formatHistoryPayloadLimits } from "./formatHistoryPayloadLimits";

const HELP_ID = "output-history-payloads-help";
const NOTE_ID = "output-history-payloads-note";

const BASE_TEXT =
  "Stores the full rows of every run from the next run on, so History can show what changed.";
// Shown instead of the figures when the server reported no `historyPayloadLimits`.
const NO_FIGURES_TEXT =
  "Very large runs keep only their summary; how many runs are kept depends on the pipeline owner's plan.";
const OPT_OUT_TEXT =
  "Turning this off stops storing rows; rows already kept expire on the normal schedule.";
const UNAVAILABLE_NOTE = "Free stores run summaries only";

interface HistoryPayloadsFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The Output's `historyPayloadsAvailable === true`. */
  available: boolean;
  /** The Output's server-reported `historyPayloadLimits`; the help copy's figures come only from here. */
  limits?: HistoryPayloadLimits;
}

export function HistoryPayloadsField({
  checked,
  onChange,
  available,
  limits,
}: HistoryPayloadsFieldProps) {
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
        {BASE_TEXT} {formatHistoryPayloadLimits(limits) ?? NO_FIGURES_TEXT} {OPT_OUT_TEXT}
      </p>
      {!available && (
        <p id={NOTE_ID} className="output-editor-sheet__field-hint">
          <span>{UNAVAILABLE_NOTE}</span>{" "}
          <Link
            className="output-editor-sheet__upsell-link"
            to="/settings#beta-access"
            target="_blank"
            rel="noopener noreferrer"
          >
            Request Beta access<span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </p>
      )}
    </div>
  );
}
