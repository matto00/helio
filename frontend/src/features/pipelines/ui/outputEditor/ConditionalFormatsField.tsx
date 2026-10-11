// The Output editor's "Conditional formatting" section (HEL-1307 D7) for metric, collection and table
// Outputs: an ordered rule list (first match wins) built from the shared form primitives (FormField for the
// visible label of each control, Select, TextField, IconButton, InlineError for the rule's error).

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

import { InlineError } from "../../../../shared/chrome/InlineError";
import {
  FormField,
  IconButton,
  Select,
  TextField,
  type SelectOption,
} from "../../../../shared/ui/index";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import {
  MAX_CONDITIONAL_RULES,
  MAX_RULE_LABEL,
  MAX_RULE_TEXT,
  parseNumeric,
  type ConditionalFormatKind,
  type ConditionalOp,
  type ConditionalTone,
} from "../../../panels/ui/renderers/conditionalFormatting";
import type { OutputConditionalFormatsState, RuleDraft } from "./useOutputConditionalFormats";

const OP_OPTIONS: SelectOption[] = [
  { value: "gt", label: "is greater than" },
  { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is at most" },
  { value: "between", label: "is between" },
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
];
const TONE_OPTIONS: SelectOption[] = [
  { value: "success", label: "Good" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Critical" },
];
const TARGET_OPTIONS: SelectOption[] = [
  { value: "cell", label: "This cell" },
  { value: "row", label: "Whole row" },
];
const NUMERIC_OPS: ReadonlySet<string> = new Set(["gt", "gte", "lt", "lte", "between"]);

type RuleField = "column" | "value" | "value2";

/** Editor-facing wording for a rejected rule, and which controls it concerns (the validator's raw message
 *  is the fallback for anything not covered). */
function describeProblem(
  draft: RuleDraft,
  kind: ConditionalFormatKind,
  raw: string,
): { message: string; fields: ReadonlySet<RuleField> } {
  const numeric = NUMERIC_OPS.has(draft.op);
  const value = parseNumeric(draft.value);
  if (kind === "table" && draft.column === "") {
    return { message: "Choose the column this rule tests.", fields: new Set(["column"]) };
  }
  if (numeric && value === null) {
    return { message: "Enter a number to compare with.", fields: new Set(["value"]) };
  }
  if (draft.op === "between") {
    const upper = parseNumeric(draft.value2);
    if (upper === null) {
      return { message: "Enter the upper number.", fields: new Set(["value2"]) };
    }
    if (value !== null && value > upper) {
      return {
        message: "The first number must not be larger than the second.",
        fields: new Set(["value", "value2"]),
      };
    }
  }
  if (!numeric && draft.value.trim() === "") {
    return { message: "Enter a number or some text to compare with.", fields: new Set(["value"]) };
  }
  if (!numeric && draft.value.trim().length > MAX_RULE_TEXT) {
    return {
      message: `Keep the text to ${MAX_RULE_TEXT} characters or fewer.`,
      fields: new Set(["value"]),
    };
  }
  return { message: raw, fields: new Set() };
}

interface ConditionalFormatsFieldProps {
  kind: ConditionalFormatKind;
  state: OutputConditionalFormatsState;
  /** Column choices for a table rule (capabilities-at-node). */
  columnOptions: SelectOption[];
}

export function ConditionalFormatsField({
  kind,
  state,
  columnOptions,
}: ConditionalFormatsFieldProps) {
  const errors = state.errorsFor(kind);
  // A freshly added rule is blank by construction: only show its error once the author has touched it.
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set());
  const touch = (id: number) => setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  const pending = state.drafts
    .map((d, i) => (errors[i] !== null && !touched.has(d.id) ? i + 1 : null))
    .filter((n): n is number => n !== null);
  return (
    <div className="output-editor-sheet__data-section conditional-formats">
      <span className="output-editor-sheet__data-label">Conditional formatting</span>
      <p className="output-editor-sheet__field-hint">
        Colour values by threshold. Rules compare the raw value (before number formatting) and the
        first matching rule wins. Each coloured value also shows a symbol, so colour is never the
        only signal.
      </p>
      {state.drafts.map((draft, index) => (
        <RuleRow
          key={draft.id}
          n={index + 1}
          kind={kind}
          draft={draft}
          error={errors[index]}
          showError={touched.has(draft.id)}
          onTouch={() => touch(draft.id)}
          isFirst={index === 0}
          isLast={index === state.drafts.length - 1}
          state={state}
          columnOptions={columnOptions}
        />
      ))}
      {pending.length > 0 && (
        <p className="output-editor-sheet__field-hint">
          {`Finish or remove rule ${pending.join(", ")} to save.`}
        </p>
      )}
      <div>
        <button
          type="button"
          className="ui-modal-btn ui-modal-btn--secondary"
          onClick={() => state.add(kind)}
          disabled={!state.canAdd}
          title={state.canAdd ? undefined : `At most ${MAX_CONDITIONAL_RULES} rules`}
        >
          Add rule
        </button>
      </div>
    </div>
  );
}

interface RuleRowProps {
  n: number;
  kind: ConditionalFormatKind;
  draft: RuleDraft;
  error: string | null;
  showError: boolean;
  onTouch: () => void;
  isFirst: boolean;
  isLast: boolean;
  state: OutputConditionalFormatsState;
  columnOptions: SelectOption[];
}

function RuleRow({
  n,
  kind,
  draft,
  error,
  showError,
  onTouch,
  isFirst,
  isLast,
  state,
  columnOptions,
}: RuleRowProps) {
  const numeric = NUMERIC_OPS.has(draft.op);
  const baseId = useId();
  const errorId = `${baseId}-error`;
  const set = (patch: Partial<Omit<RuleDraft, "id">>) => {
    onTouch();
    state.update(draft.id, patch);
  };
  const problem = showError && error !== null ? describeProblem(draft, kind, error) : null;
  const concerns = (field: RuleField) => problem?.fields.has(field) === true;
  const describe = (field: RuleField) => (concerns(field) ? errorId : undefined);
  return (
    <div role="group" aria-label={`Rule ${n}`} className="conditional-formats__rule">
      <div className="conditional-formats__controls">
        {kind === "table" && (
          <FormField label="Column" htmlFor={`${baseId}-column`}>
            <Select
              id={`${baseId}-column`}
              ariaLabel={`Rule ${n} column`}
              value={draft.column}
              onChange={(v) => set({ column: v })}
              options={[{ value: "", label: "Choose column…" }, ...columnOptions]}
              ariaInvalid={concerns("column")}
              ariaDescribedBy={describe("column")}
            />
          </FormField>
        )}
        <FormField label="Condition" htmlFor={`${baseId}-op`}>
          <Select
            id={`${baseId}-op`}
            ariaLabel={`Rule ${n} condition`}
            value={draft.op}
            onChange={(v) => set({ op: v as ConditionalOp })}
            options={OP_OPTIONS}
          />
        </FormField>
        <FormField label={draft.op === "between" ? "From" : "Value"} htmlFor={`${baseId}-value`}>
          <TextField
            id={`${baseId}-value`}
            aria-label={draft.op === "between" ? `Rule ${n} from` : `Rule ${n} value`}
            type={numeric ? "number" : "text"}
            step={numeric ? "any" : undefined}
            value={draft.value}
            onChange={(e) => set({ value: e.target.value })}
            onBlur={onTouch}
            placeholder={numeric ? "e.g. 80" : "number or text"}
            aria-invalid={concerns("value") ? true : undefined}
            aria-describedby={describe("value")}
          />
        </FormField>
        {draft.op === "between" && (
          <FormField label="To" htmlFor={`${baseId}-value2`}>
            <TextField
              id={`${baseId}-value2`}
              aria-label={`Rule ${n} to`}
              type="number"
              step="any"
              value={draft.value2}
              onChange={(e) => set({ value2: e.target.value })}
              onBlur={onTouch}
              placeholder="e.g. 100"
              aria-invalid={concerns("value2") ? true : undefined}
              aria-describedby={describe("value2")}
            />
          </FormField>
        )}
        <FormField label="Colour" htmlFor={`${baseId}-tone`}>
          <Select
            id={`${baseId}-tone`}
            ariaLabel={`Rule ${n} colour`}
            value={draft.tone}
            onChange={(v) => set({ tone: v as ConditionalTone })}
            options={TONE_OPTIONS}
          />
        </FormField>
        {kind === "table" && (
          <FormField label="Applies to" htmlFor={`${baseId}-target`}>
            <Select
              id={`${baseId}-target`}
              ariaLabel={`Rule ${n} applies to`}
              value={draft.target ?? "cell"}
              onChange={(v) => set({ target: v as "cell" | "row" })}
              options={TARGET_OPTIONS}
            />
          </FormField>
        )}
        <FormField label="Label" htmlFor={`${baseId}-label`} optional>
          <TextField
            id={`${baseId}-label`}
            aria-label={`Rule ${n} label`}
            value={draft.label}
            onChange={(e) => set({ label: e.target.value })}
            placeholder="e.g. Too slow"
            maxLength={MAX_RULE_LABEL}
          />
        </FormField>
      </div>
      <div className="conditional-formats__actions">
        <IconButton
          aria-label={`Move rule ${n} up`}
          icon={<ArrowUp size={ICON_SIZE.sm} />}
          onClick={() => state.move(draft.id, -1)}
          disabled={isFirst}
          size="xs"
        />
        <IconButton
          aria-label={`Move rule ${n} down`}
          icon={<ArrowDown size={ICON_SIZE.sm} />}
          onClick={() => state.move(draft.id, 1)}
          disabled={isLast}
          size="xs"
        />
        <IconButton
          aria-label={`Remove rule ${n}`}
          icon={<Trash2 size={ICON_SIZE.sm} />}
          onClick={() => state.remove(draft.id)}
          variant="danger"
          size="xs"
        />
      </div>
      {problem !== null && (
        <div className="conditional-formats__error">
          <InlineError id={errorId} error={`Rule ${n}: ${problem.message}`} />
        </div>
      )}
    </div>
  );
}
