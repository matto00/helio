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
});
