// HEL-1189 design.md D7 — the output-controls editor's local list reducer: add/rebind/edit/
// remove/dirty. Mirrors `useFormEditorState.ts`'s shape (pure state management; eligibility logic
// lives in `state/outputControlEligibility.ts`, rendering in `OutputControlsEditor.tsx`).

import { useCallback, useMemo, useReducer } from "react";

import type { OutputControlDefaultValue, OutputControlSpec } from "../../types/panel";

interface OutputControlsEditorState {
  controls: OutputControlSpec[];
}

function toState(controls: OutputControlSpec[]): OutputControlsEditorState {
  return { controls };
}

type Action =
  | { type: "add"; control: OutputControlSpec }
  | { type: "rebind"; index: number; column: string }
  | { type: "setLabel"; index: number; label: string }
  | { type: "setDefaultValue"; index: number; value: OutputControlDefaultValue | undefined }
  | { type: "remove"; index: number }
  | { type: "reset"; controls: OutputControlSpec[] };

function reducer(state: OutputControlsEditorState, action: Action): OutputControlsEditorState {
  switch (action.type) {
    case "add":
      return { controls: [...state.controls, action.control] };
    case "rebind":
      return {
        controls: state.controls.map((c, i) =>
          i === action.index ? { ...c, column: action.column } : c,
        ),
      };
    case "setLabel":
      return {
        controls: state.controls.map((c, i) =>
          i === action.index ? { ...c, label: action.label } : c,
        ),
      };
    case "setDefaultValue":
      return {
        controls: state.controls.map((c, i) =>
          i === action.index ? { ...c, defaultValue: action.value } : c,
        ),
      };
    case "remove":
      return { controls: state.controls.filter((_, i) => i !== action.index) };
    case "reset":
      return toState(action.controls);
  }
}

export interface UseOutputControlsEditorStateResult {
  controls: OutputControlSpec[];
  dirty: boolean;
  /** Appends a new control, already fully built (id/kind/column/label) by the caller — the
   *  auto-bind rule (design.md's "first eligible column, schema order") is the caller's job, since
   *  it needs the fetched capability contract this hook doesn't hold. */
  add: (control: OutputControlSpec) => void;
  rebind: (index: number, column: string) => void;
  setLabel: (index: number, label: string) => void;
  setDefaultValue: (index: number, value: OutputControlDefaultValue | undefined) => void;
  remove: (index: number) => void;
  reset: () => void;
}

export function useOutputControlsEditorState(
  initialControls: OutputControlSpec[],
): UseOutputControlsEditorStateResult {
  const [state, dispatch] = useReducer(reducer, toState(initialControls));
  const initialState = useMemo(() => toState(initialControls), [initialControls]);

  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(initialState),
    [state, initialState],
  );

  const add = useCallback((control: OutputControlSpec) => dispatch({ type: "add", control }), []);
  const rebind = useCallback(
    (index: number, column: string) => dispatch({ type: "rebind", index, column }),
    [],
  );
  const setLabel = useCallback(
    (index: number, label: string) => dispatch({ type: "setLabel", index, label }),
    [],
  );
  const setDefaultValue = useCallback(
    (index: number, value: OutputControlDefaultValue | undefined) =>
      dispatch({ type: "setDefaultValue", index, value }),
    [],
  );
  const remove = useCallback((index: number) => dispatch({ type: "remove", index }), []);
  const reset = useCallback(
    () => dispatch({ type: "reset", controls: initialControls }),
    [initialControls],
  );

  return { controls: state.controls, dirty, add, rebind, setLabel, setDefaultValue, remove, reset };
}

/** design.md's auto-bind rule: the first column, in schema declaration order, that
 *  `isEligibleForKind` accepts. `null` when no eligible column exists (the kind should not have
 *  been offered at all — see `output-panel-controls-editor` spec's "a kind with no eligible
 *  column is never offered"). */
export function firstEligibleColumn(
  schemaColumnOrder: string[],
  isEligibleForKind: (column: string) => boolean,
): string | null {
  return schemaColumnOrder.find(isEligibleForKind) ?? null;
}
