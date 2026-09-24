import { act, renderHook } from "@testing-library/react";

import { useFormPanelValues } from "./useFormPanelValues";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormFieldSpec } from "../../types/panel";

const quantityField: FormFieldSpec = {
  sourceField: "quantity",
  control: "number",
  label: "Quantity",
  initialValue: 5,
};

const activeField: FormFieldSpec = {
  sourceField: "active",
  control: "checkbox",
  label: "Active",
};

const noteField: FormFieldSpec = {
  sourceField: "note",
  control: "text",
  label: "Note",
  required: true,
};

const schema: DatasetFieldResponse[] = [
  { name: "quantity", type: "integer", required: false },
  { name: "active", type: "boolean", required: false },
  { name: "note", type: "string", required: false },
];

describe("useFormPanelValues", () => {
  it("prefills a field's value from initialValue", () => {
    const { result } = renderHook(() => useFormPanelValues([quantityField], schema));
    expect(result.current.values.quantity).toBe("5");
  });

  it("seeds a control-appropriate empty for a field with no initialValue", () => {
    const { result } = renderHook(() => useFormPanelValues([activeField, noteField], schema));
    expect(result.current.values.active).toBe(false);
    expect(result.current.values.note).toBe("");
  });

  it("gates errors on touched state — no error until the field is touched", () => {
    const { result } = renderHook(() => useFormPanelValues([noteField], schema));
    expect(result.current.errors.note).toBeNull();

    act(() => result.current.touch("note"));
    expect(result.current.errors.note).toBe("Note is required");
  });

  it("clears an error once the value is corrected", () => {
    const { result } = renderHook(() => useFormPanelValues([noteField], schema));
    act(() => result.current.touch("note"));
    expect(result.current.errors.note).toBe("Note is required");

    act(() => result.current.setValue("note", "hello"));
    expect(result.current.errors.note).toBeNull();
  });

  it("reset restores the seeded values and clears touched state", () => {
    const { result } = renderHook(() => useFormPanelValues([noteField], schema));
    act(() => {
      result.current.setValue("note", "hello");
      result.current.touch("note");
    });
    expect(result.current.values.note).toBe("hello");

    act(() => result.current.reset());
    expect(result.current.values.note).toBe("");
    expect(result.current.touched.note).toBeUndefined();
  });

  it("re-seeds values and touched state when the field list changes", () => {
    const { result, rerender } = renderHook(
      ({ fields }: { fields: FormFieldSpec[] }) => useFormPanelValues(fields, schema),
      { initialProps: { fields: [noteField] } },
    );
    act(() => {
      result.current.setValue("note", "hello");
      result.current.touch("note");
    });
    expect(result.current.values.note).toBe("hello");

    rerender({ fields: [noteField, quantityField] });
    expect(result.current.values.note).toBe("");
    expect(result.current.values.quantity).toBe("5");
    expect(result.current.touched.note).toBeUndefined();
  });

  // HEL-1087 tasks.md 2.3/3.5
  it("markAllTouched shows every field's error at once", () => {
    const { result } = renderHook(() => useFormPanelValues([noteField, quantityField], schema));
    expect(result.current.errors.note).toBeNull();

    act(() => result.current.markAllTouched());
    expect(result.current.errors.note).toBe("Note is required");
    expect(result.current.touched.quantity).toBe(true);
  });

  it("setExternalErrors takes precedence over the client-side rule", () => {
    const { result } = renderHook(() => useFormPanelValues([noteField], schema));
    act(() => result.current.setValue("note", "hello"));
    expect(result.current.errors.note).toBeNull();

    act(() => result.current.setExternalErrors({ note: "server says no" }));
    expect(result.current.errors.note).toBe("server says no");
  });

  it("setValue clears that field's external error", () => {
    const { result } = renderHook(() => useFormPanelValues([noteField], schema));
    act(() => result.current.setExternalErrors({ note: "server says no" }));
    expect(result.current.errors.note).toBe("server says no");

    act(() => result.current.setValue("note", "fixed"));
    expect(result.current.errors.note).toBeNull();
  });

  it("a setValue on an UNRELATED field leaves another field's external error intact", () => {
    const { result } = renderHook(() => useFormPanelValues([noteField, quantityField], schema));
    act(() => result.current.setExternalErrors({ note: "server says no" }));
    act(() => result.current.setValue("quantity", "7"));
    expect(result.current.errors.note).toBe("server says no");
  });

  // HEL-1169 tasks.md 2.0, design.md D3a — `reconcileValue` applies a fetched aggregate but must
  // never clear an `externalErrors` entry the way `setValue` does; otherwise a definite
  // rejection's own trailing reconciliation fetch would silently erase the `aria-invalid` state
  // the same settle just set (round-2 design-gate CR1).
  it("reconcileValue updates the value but leaves an external error untouched", () => {
    const { result } = renderHook(() => useFormPanelValues([noteField], schema));
    act(() => result.current.setExternalErrors({ note: "server says no" }));
    expect(result.current.errors.note).toBe("server says no");

    act(() => result.current.reconcileValue("note", "5"));
    expect(result.current.errors.note).toBe("server says no");
    expect(result.current.values.note).toBe("5");
  });

  it("a file control seeds empty despite a configured initialValue", () => {
    const fileField: FormFieldSpec = {
      sourceField: "photo",
      control: "file",
      label: "Photo",
      initialValue: { id: "some-binary-ref" },
    };
    const fileSchema: DatasetFieldResponse[] = [
      { name: "photo", type: "binary-ref", required: false },
    ];
    const { result } = renderHook(() => useFormPanelValues([fileField], fileSchema));
    expect(result.current.values.photo).toBeNull();
  });
});
