// HEL-1084 design.md D5/D7 — the form builder's field-list reducer: add/remove/
// reorder/edit/dirty. Pure state management; validation lives in
// `state/formConfigValidation.ts`, rendering in `FormEditor.tsx`/`FormFieldRow.tsx`.

import { useCallback, useMemo, useReducer } from "react";

import { defaultControl } from "../../state/formConfigValidation";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormFieldSpec, FormPanelConfig } from "../../types/panel";

interface FormEditorState {
  dataSourceId: string;
  fields: FormFieldSpec[];
  /** Stable per-row identity, parallel to `fields` — NOT derived from
   *  `sourceField` (two rows can transiently share a `sourceField`, e.g. an
   *  orphaned/duplicate stored config) and NOT the array index (evaluation-1.md
   *  CR1: `key={index}` let React reconcile the wrong DOM node into a
   *  shifted-into position after Remove, which is what made focus behavior
   *  work "by accident" for every case except removing the last row of a
   *  2+-field list). Assigned once per row at add/reset time and never
   *  recomputed from position. */
  rowIds: string[];
}

function toState(config: FormPanelConfig): FormEditorState {
  return {
    dataSourceId: config.dataSourceId,
    fields: config.fields,
    rowIds: config.fields.map((_, i) => `row-${i}`),
  };
}

/** design.md Decision 3: a single-counter-field config's persisted `submit.resetOnSuccess` is
 *  ALWAYS `false`, not a user-facing toggle — the compact layout's client-side optimistic tally
 *  (HEL-1088) would otherwise be wiped by `FormPanelView.handleSubmit`'s existing
 *  `if (config.submit.resetOnSuccess !== false) values.reset();` line after every single click. */
function isSingleCounterField(fields: FormFieldSpec[]): boolean {
  return fields.length === 1 && fields[0].control === "counter";
}

function toConfig(state: FormEditorState): FormPanelConfig {
  return {
    dataSourceId: state.dataSourceId,
    fields: state.fields,
    submit: isSingleCounterField(state.fields)
      ? { writeMode: "append", resetOnSuccess: false }
      : { writeMode: "append" },
  };
}

type Action =
  | { type: "add"; sourceField: string; control: FormFieldSpec["control"]; rowId: string }
  | { type: "remove"; index: number }
  | { type: "moveUp"; index: number }
  | { type: "moveDown"; index: number }
  | {
      type: "setSourceField";
      index: number;
      sourceField: string;
      control: FormFieldSpec["control"];
    }
  | { type: "setControl"; index: number; control: FormFieldSpec["control"] }
  | { type: "setAttr"; index: number; attr: Partial<FormFieldSpec> }
  | { type: "setDataset"; dataSourceId: string }
  | { type: "reset"; config: FormPanelConfig };

/** Attributes `control` doesn't accept, dropped visibly on a control switch
 *  (design.md D4: "step is shown only for control: number... options only
 *  for select... switching control away drops the now-invalid attribute"). */
function dropIncompatibleAttrs(
  field: FormFieldSpec,
  newControl: FormFieldSpec["control"],
): FormFieldSpec {
  const next = { ...field, control: newControl };
  if (newControl !== "number" && newControl !== "counter") delete next.step;
  if (newControl !== "select") delete next.options;
  return next;
}

function reducer(state: FormEditorState, action: Action): FormEditorState {
  switch (action.type) {
    case "add":
      return {
        ...state,
        fields: [...state.fields, { sourceField: action.sourceField, control: action.control }],
        rowIds: [...state.rowIds, action.rowId],
      };
    case "remove":
      return {
        ...state,
        fields: state.fields.filter((_, i) => i !== action.index),
        rowIds: state.rowIds.filter((_, i) => i !== action.index),
      };
    case "moveUp": {
      if (action.index <= 0) return state;
      const fields = [...state.fields];
      [fields[action.index - 1], fields[action.index]] = [
        fields[action.index],
        fields[action.index - 1],
      ];
      const rowIds = [...state.rowIds];
      [rowIds[action.index - 1], rowIds[action.index]] = [
        rowIds[action.index],
        rowIds[action.index - 1],
      ];
      return { ...state, fields, rowIds };
    }
    case "moveDown": {
      if (action.index >= state.fields.length - 1) return state;
      const fields = [...state.fields];
      [fields[action.index], fields[action.index + 1]] = [
        fields[action.index + 1],
        fields[action.index],
      ];
      const rowIds = [...state.rowIds];
      [rowIds[action.index], rowIds[action.index + 1]] = [
        rowIds[action.index + 1],
        rowIds[action.index],
      ];
      return { ...state, fields, rowIds };
    }
    case "setSourceField": {
      const fields = state.fields.map((f, i) =>
        i === action.index ? { sourceField: action.sourceField, control: action.control } : f,
      );
      return { ...state, fields };
    }
    case "setControl": {
      const fields = state.fields.map((f, i) =>
        i === action.index ? dropIncompatibleAttrs(f, action.control) : f,
      );
      return { ...state, fields };
    }
    case "setAttr": {
      const fields = state.fields.map((f, i) =>
        i === action.index ? { ...f, ...action.attr } : f,
      );
      return { ...state, fields };
    }
    case "setDataset":
      // Keeps the fields (design.md D5: "re-validates — orphaned fields are
      // flagged with a Remove affordance, never dropped").
      return { ...state, dataSourceId: action.dataSourceId };
    case "reset":
      return toState(action.config);
  }
}

export interface UseFormEditorStateResult {
  config: FormPanelConfig;
  /** Stable per-row identity, parallel to `config.fields` — use as the
   *  `key` in any list render of the fields (evaluation-1.md CR1); never
   *  the array index. */
  rowKeys: string[];
  dirty: boolean;
  addField: (schema: DatasetFieldResponse[]) => void;
  removeField: (index: number) => void;
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
  setSourceField: (index: number, sourceField: string, schema: DatasetFieldResponse[]) => void;
  setControl: (index: number, control: FormFieldSpec["control"]) => void;
  setAttr: (index: number, attr: Partial<FormFieldSpec>) => void;
  setDataset: (dataSourceId: string) => void;
  reset: () => void;
}

/** The next unused declared field for "Add" (design.md's "first unused
 *  declared field, its default control"). `undefined` when every declared
 *  field is already used. */
export function firstUnusedDeclaredField(
  schema: DatasetFieldResponse[],
  fields: FormFieldSpec[],
): DatasetFieldResponse | undefined {
  const used = new Set(fields.map((f) => f.sourceField));
  return schema.find((f) => !used.has(f.name));
}

/** design.md D7: "focus moves to ... the next row (or the Add control) after
 *  Remove". Pure so the edge cases (remove the only remaining row, remove the
 *  last of 2+, remove a middle row) are unit-testable without a DOM —
 *  jsdom's `document.activeElement` tracking does not faithfully reproduce
 *  React's real reconciliation-driven DOM node identity (evaluation-1.md
 *  Phase 3 / C6), so this pure function plus a rendered/Playwright
 *  measurement are what actually cover this behavior; jsdom evidence alone
 *  is not (see `mutation-evidence.md`). Returns `null` when no row remains
 *  (focus the Add control instead); otherwise the index of the row that now
 *  occupies the removed row's position (or the new last row, if the removed
 *  row was last). */
export function focusTargetIndexAfterRemove(
  removedIndex: number,
  newLength: number,
): number | null {
  if (newLength <= 0) return null;
  return Math.min(removedIndex, newLength - 1);
}

let nextRowIdCounter = 0;

/** Generates a fresh, render-independent row id for "add" — never derived
 *  from array position (see `FormEditorState.rowIds`'s doc comment). */
function generateRowId(): string {
  nextRowIdCounter += 1;
  return `new-row-${nextRowIdCounter}`;
}

export function useFormEditorState(initialConfig: FormPanelConfig): UseFormEditorStateResult {
  const [state, dispatch] = useReducer(reducer, toState(initialConfig));
  const initialState = useMemo(() => toState(initialConfig), [initialConfig]);

  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(initialState),
    [state, initialState],
  );

  const addField = useCallback(
    (schema: DatasetFieldResponse[]) => {
      const next = firstUnusedDeclaredField(schema, state.fields);
      if (!next) return;
      dispatch({
        type: "add",
        sourceField: next.name,
        control: defaultControl(next.type),
        rowId: generateRowId(),
      });
    },
    [state.fields],
  );

  const removeField = useCallback((index: number) => dispatch({ type: "remove", index }), []);
  const moveUp = useCallback((index: number) => dispatch({ type: "moveUp", index }), []);
  const moveDown = useCallback((index: number) => dispatch({ type: "moveDown", index }), []);

  const setSourceField = useCallback(
    (index: number, sourceField: string, schema: DatasetFieldResponse[]) => {
      const declared = schema.find((f) => f.name === sourceField);
      dispatch({
        type: "setSourceField",
        index,
        sourceField,
        control: declared ? defaultControl(declared.type) : "text",
      });
    },
    [],
  );

  const setControl = useCallback(
    (index: number, control: FormFieldSpec["control"]) =>
      dispatch({ type: "setControl", index, control }),
    [],
  );

  const setAttr = useCallback(
    (index: number, attr: Partial<FormFieldSpec>) => dispatch({ type: "setAttr", index, attr }),
    [],
  );

  const setDataset = useCallback(
    (dataSourceId: string) => dispatch({ type: "setDataset", dataSourceId }),
    [],
  );

  const reset = useCallback(
    () => dispatch({ type: "reset", config: initialConfig }),
    [initialConfig],
  );

  return {
    config: toConfig(state),
    rowKeys: state.rowIds,
    dirty,
    addField,
    removeField,
    moveUp,
    moveDown,
    setSourceField,
    setControl,
    setAttr,
    setDataset,
    reset,
  };
}
