// Editor state for `config.conditionalFormats` (HEL-1307 D7): a list of string-typed drafts (what the author
// is typing) converted to the wire shape on demand. Validation reuses `validateConditionalFormatRule`, the
// same helper the tolerant reader and the shared seam fixture use, so the editor cannot save a rule the
// server would reject.

import { useCallback, useMemo, useRef, useState } from "react";

import {
  MAX_CONDITIONAL_RULES,
  parseNumeric,
  validateConditionalFormatRule,
  type ConditionalFormatKind,
  type ConditionalFormatRule,
  type ConditionalOp,
  type ConditionalTarget,
  type ConditionalTone,
} from "../../../panels/ui/renderers/conditionalFormatting";

export interface RuleDraft {
  id: number;
  op: ConditionalOp;
  value: string;
  value2: string;
  tone: ConditionalTone;
  label: string;
  column: string;
  /** `undefined` keeps a stored rule that never named a target exactly as stored. */
  target: ConditionalTarget | undefined;
}

export interface OutputConditionalFormatsState {
  drafts: RuleDraft[];
  canAdd: boolean;
  add: (kind: ConditionalFormatKind) => void;
  update: (id: number, patch: Partial<Omit<RuleDraft, "id">>) => void;
  remove: (id: number) => void;
  move: (id: number, direction: -1 | 1) => void;
  /** The wire rules for `kind` (invalid drafts included, so callers must gate on `errorsFor`). */
  rulesFor: (kind: ConditionalFormatKind) => ConditionalFormatRule[];
  /** Only the rules that pass validation (the live metric preview applies these). */
  validRulesFor: (kind: ConditionalFormatKind) => ConditionalFormatRule[];
  /** One entry per draft: the reason it would be rejected, else `null`. */
  errorsFor: (kind: ConditionalFormatKind) => (string | null)[];
  hasErrors: (kind: ConditionalFormatKind) => boolean;
  /** The stored config carried the key, so an emptied list must be written as `[]`. */
  storedKey: boolean;
}

const NUMERIC_OPS: ReadonlySet<ConditionalOp> = new Set(["gt", "gte", "lt", "lte", "between"]);

/** Draft -> wire object (may be invalid: a blank/non-numeric numeric field becomes NaN). */
export function draftToWire(
  draft: RuleDraft,
  kind: ConditionalFormatKind,
): Record<string, unknown> {
  const wire: Record<string, unknown> = { op: draft.op };
  if (NUMERIC_OPS.has(draft.op)) {
    wire.value = parseNumeric(draft.value) ?? Number.NaN;
    if (draft.op === "between") wire.value2 = parseNumeric(draft.value2) ?? Number.NaN;
  } else {
    const text = draft.value.trim();
    // A numeric-looking value is stored as a JSON number (the spec's numeric definition), else as text.
    wire.value = parseNumeric(text) ?? text;
  }
  wire.tone = draft.tone;
  const label = draft.label.trim();
  if (label !== "") wire.label = label;
  if (kind === "table") {
    wire.column = draft.column;
    if (draft.target !== undefined) wire.target = draft.target;
  }
  return wire;
}

export function ruleToDraft(id: number, rule: ConditionalFormatRule): RuleDraft {
  return {
    id,
    op: rule.op,
    value: String(rule.value),
    value2: rule.value2 === undefined ? "" : String(rule.value2),
    tone: rule.tone,
    label: rule.label ?? "",
    column: rule.column ?? "",
    target: rule.target,
  };
}

export function useOutputConditionalFormats(
  seed: ConditionalFormatRule[] | undefined,
): OutputConditionalFormatsState {
  const nextId = useRef((seed ?? []).length);
  const [drafts, setDrafts] = useState<RuleDraft[]>(() =>
    (seed ?? []).map((rule, index) => ruleToDraft(index, rule)),
  );
  const storedKey = seed !== undefined;

  const add = useCallback((kind: ConditionalFormatKind) => {
    setDrafts((prev) =>
      prev.length >= MAX_CONDITIONAL_RULES
        ? prev
        : [
            ...prev,
            {
              id: nextId.current++,
              op: "lt",
              value: "",
              value2: "",
              tone: "error",
              label: "",
              column: "",
              target: kind === "table" ? "cell" : undefined,
            },
          ],
    );
  }, []);
  const update = useCallback((id: number, patch: Partial<Omit<RuleDraft, "id">>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);
  const remove = useCallback((id: number) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);
  const move = useCallback((id: number, direction: -1 | 1) => {
    setDrafts((prev) => {
      const from = prev.findIndex((d) => d.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  return useMemo<OutputConditionalFormatsState>(() => {
    const wire = (kind: ConditionalFormatKind) => drafts.map((d) => draftToWire(d, kind));
    const errorsFor = (kind: ConditionalFormatKind) =>
      wire(kind).map((w) => validateConditionalFormatRule(w, kind));
    return {
      drafts,
      canAdd: drafts.length < MAX_CONDITIONAL_RULES,
      add,
      update,
      remove,
      move,
      rulesFor: (kind) => wire(kind) as unknown as ConditionalFormatRule[],
      validRulesFor: (kind) => {
        const errors = errorsFor(kind);
        return wire(kind).filter(
          (_, i) => errors[i] === null,
        ) as unknown as ConditionalFormatRule[];
      },
      errorsFor,
      hasErrors: (kind) => errorsFor(kind).some((e) => e !== null),
      storedKey,
    };
  }, [drafts, add, update, remove, move, storedKey]);
}
