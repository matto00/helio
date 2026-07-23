// PipelineScheduleDialog — Modal-based form for setting/editing/clearing a
// pipeline's schedule (design D1). Does NOT fetch: it reads the already-loaded
// `schedule[pipelineId]` from Redux (populated by the page-mount
// `fetchPipelineSchedule` thunk, see PipelineDetailPage.tsx) via a `schedule`
// prop, and only dispatches `savePipelineSchedule`/`deletePipelineSchedule` on
// submit. Local `open`/`saving`/`error` state mirrors PipelineShareDialog's
// UI-state shape (not its data-fetching).
//
// Interval schedules use a friendly number + unit picker that composes the
// wire `<n><unit>` expression (design D2) rather than free-text entry; cron
// stays a mono TextField with a format hint, since a friendlier cron widget
// would need a new dependency (non-goal).

import { useEffect, useState } from "react";

import { Modal } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { InlineError } from "../../../shared/chrome/InlineError";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { savePipelineSchedule, deletePipelineSchedule } from "../state/pipelinesSlice";
import type {
  PipelineSchedule,
  PutPipelineScheduleRequest,
  ScheduleKind,
} from "../types/pipelineSchedule";

import "./PipelineScheduleDialog.css";

interface PipelineScheduleDialogProps {
  pipelineId: string;
  /** The pipeline's already-loaded schedule (from `state.pipelines.schedule`),
   *  or `null` to create a new one. The dialog does not fetch this itself. */
  schedule: PipelineSchedule | null;
  open: boolean;
  onClose: () => void;
}

const INTERVAL_UNITS = [
  { value: "s", label: "Seconds" },
  { value: "m", label: "Minutes" },
  { value: "h", label: "Hours" },
  { value: "d", label: "Days" },
];

const KIND_OPTIONS = [
  { value: "interval", label: "Interval" },
  { value: "cron", label: "Cron" },
];

// Matches the backend's `PipelineScheduleService.intervalPattern` shape (design D2).
const INTERVAL_PATTERN = /^(\d+)(s|m|h|d)$/;

function decomposeInterval(expression: string): { value: string; unit: string; raw: string } {
  const match = INTERVAL_PATTERN.exec(expression);
  if (match) {
    return { value: match[1], unit: match[2], raw: expression };
  }
  // Shouldn't happen — the backend rejects anything else — but fall back to an
  // empty number field with the raw expression preserved rather than silently
  // dropping data (design D2).
  return { value: "", unit: "m", raw: expression };
}

export function PipelineScheduleDialog({
  pipelineId,
  schedule,
  open,
  onClose,
}: PipelineScheduleDialogProps) {
  const dispatch = useAppDispatch();

  const [kind, setKind] = useState<ScheduleKind>("interval");
  const [intervalValue, setIntervalValue] = useState("");
  const [intervalUnit, setIntervalUnit] = useState("m");
  const [rawIntervalExpression, setRawIntervalExpression] = useState("");
  const [cronExpression, setCronExpression] = useState("");
  const [timezone, setTimezone] = useState("");
  const [enabled, setEnabled] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize local form fields from the (already-loaded) schedule whenever
  // the dialog opens — not on every render, so mid-edit keystrokes aren't
  // clobbered by an unrelated Redux update.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (schedule) {
      setKind(schedule.kind);
      setEnabled(schedule.enabled);
      setTimezone(schedule.timezone);
      if (schedule.kind === "interval") {
        const decomposed = decomposeInterval(schedule.expression);
        setIntervalValue(decomposed.value);
        setIntervalUnit(decomposed.unit);
        setRawIntervalExpression(decomposed.raw);
        setCronExpression("");
      } else {
        setCronExpression(schedule.expression);
        setIntervalValue("");
        setIntervalUnit("m");
        setRawIntervalExpression("");
      }
    } else {
      setKind("interval");
      setEnabled(true);
      // New schedules default to the browser's own timezone (design D3).
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      setIntervalValue("");
      setIntervalUnit("m");
      setRawIntervalExpression("");
      setCronExpression("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function composeExpression(): string {
    if (kind === "cron") return cronExpression;
    const trimmed = intervalValue.trim();
    if (trimmed !== "") return `${trimmed}${intervalUnit}`;
    // Number field is empty (e.g. an undecomposable persisted expression) —
    // preserve the original rather than submitting a malformed token.
    return rawIntervalExpression;
  }

  async function handleSave() {
    const request: PutPipelineScheduleRequest = {
      kind,
      expression: composeExpression(),
      enabled,
      timezone,
    };
    setSaving(true);
    setError(null);
    try {
      await dispatch(savePipelineSchedule({ pipelineId, request })).unwrap();
      onClose();
    } catch (message) {
      setError(typeof message === "string" ? message : "Failed to save pipeline schedule.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    try {
      await dispatch(deletePipelineSchedule(pipelineId)).unwrap();
      onClose();
    } catch (message) {
      setError(typeof message === "string" ? message : "Failed to clear pipeline schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={schedule ? "Edit schedule" : "Set schedule"}
      description="Choose when this pipeline should run automatically."
      size="sm"
      ariaLabel="Pipeline schedule"
      footer={
        <div className="pipeline-schedule-dialog__footer">
          {schedule && (
            <button
              type="button"
              className="pipeline-schedule-dialog__clear-btn"
              onClick={() => void handleClear()}
              disabled={saving}
            >
              Clear schedule
            </button>
          )}
          <div className="pipeline-schedule-dialog__footer-spacer" />
          <button
            type="button"
            className="pipeline-schedule-dialog__cancel-btn"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pipeline-schedule-dialog__save-btn"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="pipeline-schedule-dialog">
        <div className="pipeline-schedule-dialog__field">
          <label className="pipeline-schedule-dialog__label" htmlFor="schedule-kind">
            Kind
          </label>
          <Select
            value={kind}
            onChange={(v) => setKind(v as ScheduleKind)}
            options={KIND_OPTIONS}
            ariaLabel="Schedule kind"
          />
        </div>

        {kind === "interval" ? (
          <div className="pipeline-schedule-dialog__field">
            <label className="pipeline-schedule-dialog__label" htmlFor="schedule-interval-value">
              Run every
            </label>
            <div className="pipeline-schedule-dialog__interval-row">
              <TextField
                id="schedule-interval-value"
                type="number"
                min={1}
                value={intervalValue}
                onChange={(e) => setIntervalValue(e.target.value)}
                aria-label="Interval number"
              />
              <Select
                value={intervalUnit}
                onChange={setIntervalUnit}
                options={INTERVAL_UNITS}
                ariaLabel="Interval unit"
              />
            </div>
          </div>
        ) : (
          <div className="pipeline-schedule-dialog__field">
            <label className="pipeline-schedule-dialog__label" htmlFor="schedule-cron">
              Cron expression
            </label>
            <TextField
              id="schedule-cron"
              mono
              placeholder="0 * * * *"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              aria-label="Cron expression"
            />
            <p className="pipeline-schedule-dialog__hint">
              5-field cron: minute hour day-of-month month day-of-week
            </p>
          </div>
        )}

        <div className="pipeline-schedule-dialog__field">
          <label className="pipeline-schedule-dialog__label" htmlFor="schedule-timezone">
            Timezone
          </label>
          <TextField
            id="schedule-timezone"
            placeholder="e.g. America/Los_Angeles"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-label="Timezone"
          />
        </div>

        <div className="pipeline-schedule-dialog__field pipeline-schedule-dialog__field--row">
          <label className="pipeline-schedule-dialog__enabled-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              aria-label="Enabled"
            />
            Enabled
          </label>
        </div>

        <InlineError error={error} />
      </div>
    </Modal>
  );
}
