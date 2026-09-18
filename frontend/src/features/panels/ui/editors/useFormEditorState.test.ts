// HEL-1084 task 4.7 — add/remove/move/setControl-drops-attrs/setDataset-keeps-fields/reset/dirty.
import { act, renderHook } from "@testing-library/react";

import { focusTargetIndexAfterRemove, useFormEditorState } from "./useFormEditorState";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormPanelConfig } from "../../types/panel";

const schema: DatasetFieldResponse[] = [
  { name: "quantity", type: "integer", required: true },
  { name: "note", type: "string", required: false },
];

function baseConfig(): FormPanelConfig {
  return { dataSourceId: "ds-1", fields: [], submit: { writeMode: "append" } };
}

describe("useFormEditorState", () => {
  it("is not dirty initially", () => {
    const { result } = renderHook(() => useFormEditorState(baseConfig()));
    expect(result.current.dirty).toBe(false);
  });

  it("addField adds the first unused declared field with its default control", () => {
    const { result } = renderHook(() => useFormEditorState(baseConfig()));
    act(() => result.current.addField(schema));
    expect(result.current.config.fields).toEqual([{ sourceField: "quantity", control: "number" }]);
    expect(result.current.dirty).toBe(true);
  });

  it("addField skips an already-used field", () => {
    const { result } = renderHook(() => useFormEditorState(baseConfig()));
    act(() => result.current.addField(schema));
    act(() => result.current.addField(schema));
    expect(result.current.config.fields.map((f) => f.sourceField)).toEqual(["quantity", "note"]);
  });

  it("removeField removes the entry at the given index", () => {
    const { result } = renderHook(() => useFormEditorState(baseConfig()));
    act(() => result.current.addField(schema));
    act(() => result.current.addField(schema));
    act(() => result.current.removeField(0));
    expect(result.current.config.fields.map((f) => f.sourceField)).toEqual(["note"]);
  });

  it("moveUp/moveDown reorder fields and clamp at the edges", () => {
    const { result } = renderHook(() => useFormEditorState(baseConfig()));
    act(() => result.current.addField(schema));
    act(() => result.current.addField(schema));
    act(() => result.current.moveUp(1));
    expect(result.current.config.fields.map((f) => f.sourceField)).toEqual(["note", "quantity"]);
    act(() => result.current.moveUp(0));
    expect(result.current.config.fields.map((f) => f.sourceField)).toEqual(["note", "quantity"]);
    act(() => result.current.moveDown(1));
    expect(result.current.config.fields.map((f) => f.sourceField)).toEqual(["note", "quantity"]);
  });

  it("setControl drops step/options the new control rejects", () => {
    const config: FormPanelConfig = {
      dataSourceId: "ds-1",
      fields: [{ sourceField: "quantity", control: "number", step: 1 }],
      submit: { writeMode: "append" },
    };
    const { result } = renderHook(() => useFormEditorState(config));
    act(() => result.current.setControl(0, "text"));
    expect(result.current.config.fields[0]).toEqual({ sourceField: "quantity", control: "text" });
  });

  it("setControl to select drops a stale step attribute", () => {
    const config: FormPanelConfig = {
      dataSourceId: "ds-1",
      fields: [{ sourceField: "quantity", control: "number", step: 1 }],
      submit: { writeMode: "append" },
    };
    const { result } = renderHook(() => useFormEditorState(config));
    act(() => result.current.setControl(0, "select"));
    expect(result.current.config.fields[0].step).toBeUndefined();
  });

  it("setDataset keeps the existing fields", () => {
    const { result } = renderHook(() => useFormEditorState(baseConfig()));
    act(() => result.current.addField(schema));
    act(() => result.current.setDataset("ds-2"));
    expect(result.current.config.dataSourceId).toBe("ds-2");
    expect(result.current.config.fields.map((f) => f.sourceField)).toEqual(["quantity"]);
  });

  it("reset restores the initial config and clears dirty", () => {
    const config = baseConfig();
    const { result } = renderHook(() => useFormEditorState(config));
    act(() => result.current.addField(schema));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.dirty).toBe(false);
    expect(result.current.config.fields).toEqual([]);
  });

  it("setAttr merges arbitrary field attributes", () => {
    const { result } = renderHook(() => useFormEditorState(baseConfig()));
    act(() => result.current.addField(schema));
    act(() => result.current.setAttr(0, { label: "Quantity" }));
    expect(result.current.config.fields[0].label).toBe("Quantity");
  });

  // evaluation-1.md CR1 — key={index} previously let React reconcile the
  // wrong DOM node into a shifted-into row position after Remove, so
  // rowKeys must move WITH their row (never derived from index) on every
  // structural operation.
  it("rowKeys stay attached to their own row through add/remove/move — never index-derived", () => {
    const { result } = renderHook(() => useFormEditorState(baseConfig()));
    act(() => result.current.addField(schema)); // adds quantity
    act(() => result.current.addField(schema)); // adds note
    const [quantityKey, noteKey] = result.current.rowKeys;
    expect(quantityKey).not.toBe(noteKey);

    // Reorder: the keys travel with their field, not with position 0/1.
    act(() => result.current.moveDown(0));
    expect(result.current.config.fields.map((f) => f.sourceField)).toEqual(["note", "quantity"]);
    expect(result.current.rowKeys).toEqual([noteKey, quantityKey]);

    // Remove the (now-first) note row: quantity's key survives, unchanged.
    act(() => result.current.removeField(0));
    expect(result.current.config.fields.map((f) => f.sourceField)).toEqual(["quantity"]);
    expect(result.current.rowKeys).toEqual([quantityKey]);
  });

  // HEL-1088 design.md Decision 3/task 2.2 — a single-counter-field config's persisted
  // `submit.resetOnSuccess` is ALWAYS `false`, never user-configurable.
  it("a single counter field forces submit.resetOnSuccess: false", () => {
    const config: FormPanelConfig = {
      dataSourceId: "ds-1",
      fields: [{ sourceField: "delta", control: "counter" }],
      submit: { writeMode: "append" },
    };
    const { result } = renderHook(() => useFormEditorState(config));
    expect(result.current.config.submit).toEqual({ writeMode: "append", resetOnSuccess: false });
  });

  it("a counter alongside another field does NOT force resetOnSuccess: false", () => {
    const config: FormPanelConfig = {
      dataSourceId: "ds-1",
      fields: [
        { sourceField: "note", control: "text" },
        { sourceField: "delta", control: "counter" },
      ],
      submit: { writeMode: "append" },
    };
    const { result } = renderHook(() => useFormEditorState(config));
    expect(result.current.config.submit).toEqual({ writeMode: "append" });
  });

  it("setControl to counter preserves an existing step attribute", () => {
    const config: FormPanelConfig = {
      dataSourceId: "ds-1",
      fields: [{ sourceField: "quantity", control: "number", step: 3 }],
      submit: { writeMode: "append" },
    };
    const { result } = renderHook(() => useFormEditorState(config));
    act(() => result.current.setControl(0, "counter"));
    expect(result.current.config.fields[0].step).toBe(3);
  });
});

// evaluation-1.md CR1 — the pure focus-target computation `FormEditor.tsx`
// drives its explicit post-Remove focus call from. jsdom's `document.activeElement`
// does not faithfully reproduce React's real reconciliation-driven DOM node
// identity (see this repo's C6 / `mutation-evidence.md`), so this function is
// unit-tested directly rather than asserted via a rendered focus claim.
describe("focusTargetIndexAfterRemove", () => {
  it("targets the Add control (null) when no row remains", () => {
    expect(focusTargetIndexAfterRemove(0, 0)).toBeNull();
  });

  it("targets the row that shifted into the removed position (remove a middle row)", () => {
    expect(focusTargetIndexAfterRemove(1, 2)).toBe(1);
  });

  it("targets the new last row when the removed row WAS the last of 2+ (the defect case)", () => {
    // Removing index 1 of an original 2-row list — newLength is 1, so the
    // only valid remaining index is 0, not the removed row's own index 1.
    expect(focusTargetIndexAfterRemove(1, 1)).toBe(0);
  });

  it("targets index 0 when removing the first of two rows", () => {
    expect(focusTargetIndexAfterRemove(0, 1)).toBe(0);
  });
});
