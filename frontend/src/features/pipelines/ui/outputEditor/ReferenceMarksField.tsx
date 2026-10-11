// HEL-1306 -- the chart Output editor's "Reference lines" section: up to 5 static lines and 3 bands on the
// value axis. Rows are edited as text drafts; only a fully valid set is committed to the sheet state, and
// an invalid one is shown inline and blocks Save (the `HistogramBinCountField` pattern), so the editor can
// only ever emit what the server accepts.

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { IconButton, Select, TextField, type SelectOption } from "../../../../shared/ui/index";
import {
  MAX_REFERENCE_BANDS,
  MAX_REFERENCE_LINES,
  type ReferenceMarks,
  type ReferenceTone,
} from "../../../../utils/referenceMarks";
import {
  bandDraftProblem,
  bandToDraft,
  draftsToMarks,
  LABEL_LIMIT,
  lineDraftProblem,
  lineToDraft,
  type BandDraft,
  type LineDraft,
  type MarkProblem,
} from "./referenceMarksDraft";

const TONE_OPTIONS: SelectOption[] = [
  { value: "neutral", label: "Neutral" },
  { value: "success", label: "Good" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Critical" },
];

const PROBLEM_TEXT: Record<MarkProblem, string> = {
  number: "Enter a finite number.",
  order: "From must be less than To.",
  label: `Label must be ${LABEL_LIMIT} characters or fewer.`,
};

interface ReferenceMarksFieldProps {
  marks: ReferenceMarks;
  onChange: (marks: ReferenceMarks) => void;
  /** Whether a draft is currently unusable, so the sheet can block Save. */
  onInvalidChange: (invalid: boolean) => void;
  /** The bar is 100% stacked: its axis is percent, so marks are stored but not drawn. */
  normalizedStack: boolean;
}

interface RowProblemProps {
  id: string;
  problem: MarkProblem | null;
}

function RowProblem({ id, problem }: RowProblemProps) {
  return problem ? (
    <p id={id} className="output-editor-sheet__type-hint" role="alert">
      {PROBLEM_TEXT[problem]}
    </p>
  ) : null;
}

interface MarkInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  numeric?: boolean;
}

function MarkInput({
  label,
  value,
  onChange,
  invalid,
  describedBy,
  numeric,
  ...rest
}: MarkInputProps) {
  return (
    <TextField
      className="output-editor-sheet__mark-input"
      inputMode={numeric ? "decimal" : undefined}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? describedBy : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}

interface ToneAndRemoveProps {
  name: string;
  tone: ReferenceTone;
  onTone: (tone: ReferenceTone) => void;
  onRemove: () => void;
}

function ToneAndRemove({ name, tone, onTone, onRemove }: ToneAndRemoveProps) {
  return (
    <>
      <Select
        ariaLabel={`${name} tone`}
        value={tone}
        options={TONE_OPTIONS}
        onChange={(v) => onTone(v as ReferenceTone)}
      />
      <IconButton
        aria-label={`Remove ${name.toLowerCase()}`}
        icon={<Trash2 />}
        variant="ghost"
        size="md"
        onClick={onRemove}
      />
    </>
  );
}

export function ReferenceMarksField({
  marks,
  onChange,
  onInvalidChange,
  normalizedStack,
}: ReferenceMarksFieldProps) {
  const [lines, setLines] = useState<LineDraft[]>(() => marks.lines.map(lineToDraft));
  const [bands, setBands] = useState<BandDraft[]>(() => marks.bands.map(bandToDraft));
  // Leaving the section (another chart type, closing the sheet) must not leave Save blocked.
  useEffect(() => () => onInvalidChange(false), [onInvalidChange]);

  const update = (nextLines: LineDraft[], nextBands: BandDraft[]) => {
    setLines(nextLines);
    setBands(nextBands);
    const committed = draftsToMarks(nextLines, nextBands);
    onInvalidChange(committed === null);
    if (committed) onChange(committed);
  };
  const patchLine = (i: number, patch: Partial<LineDraft>) =>
    update(
      lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
      bands,
    );
  const patchBand = (i: number, patch: Partial<BandDraft>) =>
    update(
      lines,
      bands.map((b, idx) => (idx === i ? { ...b, ...patch } : b)),
    );

  return (
    <div className="output-editor-sheet__data-section" role="group" aria-label="Reference lines">
      <span className="output-editor-sheet__data-label">Reference lines</span>
      {lines.map((line, i) => {
        const problem = lineDraftProblem(line);
        const name = `Line ${i + 1}`;
        const errorId = `output-reference-line-${i}-error`;
        return (
          <div key={i} className="output-editor-sheet__mark-block">
            <div className="output-editor-sheet__mark-row">
              <MarkInput
                label={`${name} value`}
                numeric
                placeholder="Value"
                value={line.value}
                invalid={problem === "number"}
                describedBy={errorId}
                onChange={(value) => patchLine(i, { value })}
              />
              <MarkInput
                label={`${name} label`}
                placeholder="Label (optional)"
                value={line.label}
                invalid={problem === "label"}
                describedBy={errorId}
                onChange={(label) => patchLine(i, { label })}
              />
              <ToneAndRemove
                name={name}
                tone={line.tone}
                onTone={(tone) => patchLine(i, { tone })}
                onRemove={() =>
                  update(
                    lines.filter((_, idx) => idx !== i),
                    bands,
                  )
                }
              />
            </div>
            <RowProblem id={errorId} problem={problem} />
          </div>
        );
      })}
      <button
        type="button"
        className="ui-modal-btn ui-modal-btn--secondary output-editor-sheet__mark-add"
        disabled={lines.length >= MAX_REFERENCE_LINES}
        onClick={() => update([...lines, { value: "", label: "", tone: "neutral" }], bands)}
      >
        Add line
      </button>
      <span className="output-editor-sheet__data-label">Reference bands</span>
      {bands.map((band, i) => {
        const problem = bandDraftProblem(band);
        const name = `Band ${i + 1}`;
        const errorId = `output-reference-band-${i}-error`;
        return (
          <div key={i} className="output-editor-sheet__mark-block">
            <div className="output-editor-sheet__mark-row">
              <MarkInput
                label={`${name} from`}
                numeric
                placeholder="From"
                value={band.from}
                invalid={problem === "number" || problem === "order"}
                describedBy={errorId}
                onChange={(from) => patchBand(i, { from })}
              />
              <MarkInput
                label={`${name} to`}
                numeric
                placeholder="To"
                value={band.to}
                invalid={problem === "number" || problem === "order"}
                describedBy={errorId}
                onChange={(to) => patchBand(i, { to })}
              />
              <MarkInput
                label={`${name} label`}
                placeholder="Label (optional)"
                value={band.label}
                invalid={problem === "label"}
                describedBy={errorId}
                onChange={(label) => patchBand(i, { label })}
              />
              <ToneAndRemove
                name={name}
                tone={band.tone}
                onTone={(tone) => patchBand(i, { tone })}
                onRemove={() =>
                  update(
                    lines,
                    bands.filter((_, idx) => idx !== i),
                  )
                }
              />
            </div>
            <RowProblem id={errorId} problem={problem} />
          </div>
        );
      })}
      <button
        type="button"
        className="ui-modal-btn ui-modal-btn--secondary output-editor-sheet__mark-add"
        disabled={bands.length >= MAX_REFERENCE_BANDS}
        onClick={() => update(lines, [...bands, { from: "", to: "", label: "", tone: "neutral" }])}
      >
        Add band
      </button>
      <p className="output-editor-sheet__field-hint">
        Static targets on the value axis; up to {MAX_REFERENCE_LINES} lines and{" "}
        {MAX_REFERENCE_BANDS} bands.
        {normalizedStack
          ? " They are saved but not drawn on a 100% stacked bar, whose axis is a percentage."
          : ""}
      </p>
    </div>
  );
}
