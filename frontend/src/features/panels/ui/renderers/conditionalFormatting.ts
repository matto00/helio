// HEL-1307 -- threshold ("conditional formatting") rules for metric, collection and table Outputs.
//
// PURE and RAW-VALUE based: every function here compares the value as the pipeline produced it, never the
// display text (`format`, `columnFormats`, and the duration format HEL-1308 adds only change what is
// shown). Keep it that way so a display format composes with the rules without touching them.
// The backend's `ConditionalFormats` validator is the write-time authority; `validateConditionalFormatRule`
// mirrors it (both are pinned by `shared-test-fixtures/conditional-formats-config.json`).

export type ConditionalTone = "success" | "warning" | "error";
export type ConditionalOp = "gt" | "gte" | "lt" | "lte" | "between" | "eq" | "neq";
export type ConditionalTarget = "cell" | "row";
export type ConditionalFormatKind = "metric" | "collection" | "table";

export interface ConditionalFormatRule {
  op: ConditionalOp;
  /** Finite number for the numeric operators; number or text for `eq`/`neq`. */
  value: number | string;
  /** Only for `between` (inclusive upper bound). */
  value2?: number;
  tone: ConditionalTone;
  /** Optional tooltip / accessible name; falls back to the tone word. */
  label?: string;
  /** Table rules only: the column whose value is tested. */
  column?: string;
  /** Table rules only; absent means `cell`. */
  target?: ConditionalTarget;
}

export const CONDITIONAL_OPS: readonly ConditionalOp[] = [
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "eq",
  "neq",
];
export const CONDITIONAL_TONES: readonly ConditionalTone[] = ["success", "warning", "error"];
export const MAX_CONDITIONAL_RULES = 20;
export const MAX_RULE_LABEL = 60;
export const MAX_RULE_TEXT = 200;

/** Visually hidden / tooltip words for a tone with no rule label (owner ruling 4). */
export const TONE_WORD: Record<ConditionalTone, string> = {
  success: "Good",
  warning: "Warning",
  error: "Critical",
};

const NUMERIC_OPS: ReadonlySet<string> = new Set(["gt", "gte", "lt", "lte", "between"]);
const RULE_KEYS: ReadonlySet<string> = new Set([
  "op",
  "value",
  "value2",
  "tone",
  "label",
  "column",
  "target",
]);

/** A raw value is numeric when, after trimming, it is non-empty and parses to a finite number. */
export function parseNumeric(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function rawText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return typeof raw === "string" ? raw : String(raw);
}

/** Does `rule` match the raw value? An empty/missing raw value matches nothing (not even `neq`). */
export function matchRule(rule: ConditionalFormatRule, raw: unknown): boolean {
  const text = rawText(raw).trim();
  if (text === "") return false;
  const n = parseNumeric(raw);
  switch (rule.op) {
    case "gt":
      return n !== null && n > Number(rule.value);
    case "gte":
      return n !== null && n >= Number(rule.value);
    case "lt":
      return n !== null && n < Number(rule.value);
    case "lte":
      return n !== null && n <= Number(rule.value);
    case "between":
      return n !== null && rule.value2 !== undefined && n >= Number(rule.value) && n <= rule.value2;
    case "eq":
    case "neq": {
      const ruleNumber = parseNumeric(rule.value);
      const equal =
        n !== null && ruleNumber !== null
          ? n === ruleNumber
          : text.toLowerCase() === String(rule.value).trim().toLowerCase();
      return rule.op === "eq" ? equal : !equal;
    }
    default:
      return false;
  }
}

/** First rule (in list order) matching the raw value, or `null`. Used by metric and collection. */
export function resolveRule(
  rules: readonly ConditionalFormatRule[] | null | undefined,
  raw: unknown,
): ConditionalFormatRule | null {
  if (!rules) return null;
  for (const rule of rules) if (matchRule(rule, raw)) return rule;
  return null;
}

/** Table: first matching `target: "cell"` (or unset) rule for `column`, tested against that column's value. */
export function resolveCellRule(
  rules: readonly ConditionalFormatRule[] | null | undefined,
  row: Record<string, unknown>,
  column: string,
): ConditionalFormatRule | null {
  if (!rules) return null;
  for (const rule of rules) {
    if (rule.column !== column || (rule.target ?? "cell") !== "cell") continue;
    if (matchRule(rule, row[column])) return rule;
  }
  return null;
}

/** Table: first matching `target: "row"` rule, each tested against the value of its own `column`. */
export function resolveRowRule(
  rules: readonly ConditionalFormatRule[] | null | undefined,
  row: Record<string, unknown>,
): ConditionalFormatRule | null {
  if (!rules) return null;
  for (const rule of rules) {
    if (rule.target !== "row" || rule.column === undefined) continue;
    if (matchRule(rule, row[rule.column])) return rule;
  }
  return null;
}

/** Accessible name / tooltip for a matched rule: its label, else the tone word. */
export function ruleName(rule: ConditionalFormatRule): string {
  return rule.label ?? TONE_WORD[rule.tone];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A present, non-null optional key (JSON `null` means absent, like the backend). */
const present = (o: Record<string, unknown>, k: string): unknown =>
  o[k] === null ? undefined : o[k];

/** `null` when the wire-shape rule is acceptable for `kind`, else the reason (same rules as the backend). */
export function validateConditionalFormatRule(
  raw: unknown,
  kind: ConditionalFormatKind,
): string | null {
  if (!isObject(raw)) return "rule must be an object";
  const unknown = Object.keys(raw).filter((k) => !RULE_KEYS.has(k));
  if (unknown.length > 0) return `unknown key ${unknown.sort().join(", ")}`;
  const op = present(raw, "op");
  if (typeof op !== "string" || !CONDITIONAL_OPS.includes(op as ConditionalOp)) {
    return `op must be one of ${CONDITIONAL_OPS.join(", ")}`;
  }
  const value = present(raw, "value");
  const value2 = present(raw, "value2");
  if (NUMERIC_OPS.has(op)) {
    if (typeof value !== "number" || !Number.isFinite(value))
      return "value must be a finite number";
    if (op === "between") {
      if (value2 === undefined) return "value2 is required for between";
      if (typeof value2 !== "number" || !Number.isFinite(value2)) {
        return "value2 must be a finite number";
      }
      if (value > value2) return "value must be <= value2 for between";
    } else if (value2 !== undefined) return "value2 is only allowed for between";
  } else {
    const ok =
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && value.trim() !== "" && value.trim().length <= MAX_RULE_TEXT);
    if (!ok) return `value must be a finite number or non-blank text of at most ${MAX_RULE_TEXT}`;
    if (value2 !== undefined) return "value2 is only allowed for between";
  }
  const tone = present(raw, "tone");
  if (typeof tone !== "string" || !CONDITIONAL_TONES.includes(tone as ConditionalTone)) {
    return `tone must be one of ${CONDITIONAL_TONES.join(", ")}`;
  }
  const label = present(raw, "label");
  if (label !== undefined) {
    if (typeof label !== "string" || label.trim() === "" || label.trim().length > MAX_RULE_LABEL) {
      return `label must be text of 1 to ${MAX_RULE_LABEL} characters`;
    }
  }
  const column = present(raw, "column");
  const target = present(raw, "target");
  if (kind === "table") {
    if (typeof column !== "string" || column.trim() === "")
      return "column is required on a table rule";
    if (target !== undefined && target !== "cell" && target !== "row") {
      return "target must be cell or row";
    }
  } else {
    if (column !== undefined) return "column is only allowed on table rules";
    if (target !== undefined) return "target is only allowed on table rules";
  }
  return null;
}

/** Wire rule (already validated) with JSON-null optional keys dropped. */
function normaliseRule(raw: Record<string, unknown>): ConditionalFormatRule {
  const rule: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== null) rule[k] = v;
  return rule as unknown as ConditionalFormatRule;
}

/** Tolerant read of `config.conditionalFormats`: a non-array yields `undefined`; an invalid rule is DROPPED (not
 *  the whole list); at most the first 20 are kept. Never throws. */
export function readConditionalFormats(
  value: unknown,
  kind: ConditionalFormatKind,
): ConditionalFormatRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ConditionalFormatRule[] = [];
  for (const raw of value) {
    if (out.length >= MAX_CONDITIONAL_RULES) break;
    if (validateConditionalFormatRule(raw, kind) === null) {
      out.push(normaliseRule(raw as Record<string, unknown>));
    }
  }
  return out;
}
