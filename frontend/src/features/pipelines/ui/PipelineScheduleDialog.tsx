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

import { useEffect, useMemo, useState } from "react";

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
import {
  computeCronNextRun,
  computeIntervalNextRun,
  isValidTimezone,
  supportedTimezones,
  validateCronExpression,
} from "./schedulePreview";

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

// F-140: a handful of common cadences so most users never have to write raw
// cron syntax by hand.
const CRON_PRESETS: { label: string; expression: string }[] = [
  { label: "Hourly", expression: "0 * * * *" },
  { label: "Daily", expression: "0 0 * * *" },
  { label: "Weekly", expression: "0 0 * * 0" },
  { label: "Monthly", expression: "0 0 1 * *" },
];

const TIMEZONE_OPTIONS_ID = "pipeline-schedule-dialog-timezones";

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
  // F-140: friendly client-side validation errors, keyed per field, so a
  // malformed interval/cron/timezone is caught before the round-trip that
  // used to surface the backend's wire-format message verbatim.
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);

  const timezoneOptions = useMemo(() => supportedTimezones(), []);

  // Initialize local form fields from the (already-loaded) schedule whenever
  // the dialog opens — not on every render, so mid-edit keystrokes aren't
  // clobbered by an unrelated Redux update.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setIntervalError(null);
    setCronError(null);
    setTimezoneError(null);
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

  // F-140: n must be a positive whole number — the backend rejects anything
  // else with a wire-format message ("Invalid interval expression '': ...")
  // this dialog deliberately hides behind a number+unit picker, so the same
  // rule is checked here first with a friendly message instead.
  function validateInterval(): string | null {
    const trimmed = intervalValue.trim();
    if (trimmed === "" || !/^\d+$/.test(trimmed) || Number.parseInt(trimmed, 10) < 1) {
      return "Enter a whole number of 1 or more.";
    }
    return null;
  }

  function validateTimezone(): string | null {
    const trimmed = timezone.trim();
    if (trimmed === "") return "Timezone is required.";
    if (!isValidTimezone(trimmed)) return `"${trimmed}" is not a recognized timezone.`;
    return null;
  }

  /** Runs all client-side checks, updating the per-field error state as a
   *  side effect, and reports whether the form is currently valid. */
  function runValidation(): boolean {
    const nextIntervalError = kind === "interval" ? validateInterval() : null;
    const nextCronError = kind === "cron" ? validateCronExpression(cronExpression) : null;
    const nextTimezoneError = validateTimezone();
    setIntervalError(nextIntervalError);
    setCronError(nextCronError);
    setTimezoneError(nextTimezoneError);
    return nextIntervalError === null && nextCronError === null && nextTimezoneError === null;
  }

  // F-140: a computed "Next run" preview so a typo (wrong unit, wrong
  // weekday) is visible before saving rather than only discoverable once the
  // schedule bar shows a surprising `nextRunAt`. Interval previews are exact
  // (an absolute instant); cron previews are a local-time approximation —
  // see schedulePreview.ts's file header for why a real timezone-aware cron
  // evaluation is out of scope here.
  const nextRunPreview = useMemo(() => {
    if (kind === "interval") {
      if (validateInterval() !== null) return null;
      return computeIntervalNextRun(Number.parseInt(intervalValue.trim(), 10), intervalUnit);
    }
    if (validateCronExpression(cronExpression) !== null) return null;
    return computeCronNextRun(cronExpression);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, intervalValue, intervalUnit, cronExpression]);

  async function handleSave() {
    if (!runValidation()) return;

    const request: PutPipelineScheduleRequest = {
      kind,
      expression: composeExpression(),
      enabled,
      timezone: timezone.trim(),
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
              className="ui-modal-btn pipeline-schedule-dialog__clear-btn"
              onClick={() => void handleClear()}
              disabled={saving}
            >
              Clear schedule
            </button>
          )}
          <div className="pipeline-schedule-dialog__footer-spacer" />
          <button
            type="button"
            className="ui-modal-btn ui-modal-btn--secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ui-modal-btn ui-modal-btn--primary"
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
            Schedule kind
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
                onChange={(e) => {
                  setIntervalValue(e.target.value);
                  setIntervalError(null);
                }}
                aria-label="Interval number"
              />
              <Select
                value={intervalUnit}
                onChange={setIntervalUnit}
                options={INTERVAL_UNITS}
                ariaLabel="Interval unit"
              />
            </div>
            <InlineError error={intervalError} />
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
              onChange={(e) => {
                setCronExpression(e.target.value);
                setCronError(null);
              }}
              aria-label="Cron expression"
            />
            <div className="pipeline-schedule-dialog__preset-row">
              {CRON_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="pipeline-schedule-dialog__preset-btn"
                  onClick={() => {
                    setCronExpression(preset.expression);
                    setCronError(null);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="pipeline-schedule-dialog__hint">
              5-field cron: minute hour day-of-month month day-of-week
            </p>
            <InlineError error={cronError} />
          </div>
        )}

        {nextRunPreview && (
          <p className="pipeline-schedule-dialog__next-run-preview">
            Next run:{" "}
            {nextRunPreview.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            {kind === "cron" && " (approximate, your local time zone)"}
          </p>
        )}

        <div className="pipeline-schedule-dialog__field">
          <label className="pipeline-schedule-dialog__label" htmlFor="schedule-timezone">
            Timezone
          </label>
          <TextField
            id="schedule-timezone"
            list={timezoneOptions.length > 0 ? TIMEZONE_OPTIONS_ID : undefined}
            placeholder="e.g. America/Los_Angeles"
            value={timezone}
            onChange={(e) => {
              setTimezone(e.target.value);
              setTimezoneError(null);
            }}
            aria-label="Timezone"
          />
          {timezoneOptions.length > 0 && (
            <datalist id={TIMEZONE_OPTIONS_ID}>
              {timezoneOptions.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          )}
          <InlineError error={timezoneError} />
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
