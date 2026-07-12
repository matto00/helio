import { act, renderHook } from "@testing-library/react";

import { useBoundOrLiteralState } from "./useBoundOrLiteralState";

describe("useBoundOrLiteralState", () => {
  it("starts clean (not dirty) and reports the initial values", () => {
    const { result } = renderHook(() => useBoundOrLiteralState("field", "rating", ""));
    expect(result.current.dirty).toBe(false);
    expect(result.current.mode).toBe("field");
    expect(result.current.fieldValue).toBe("rating");
    expect(result.current.patchValue).toBeUndefined();
    expect(result.current.fieldMappingValue).toBe("rating");
  });

  it("becomes dirty and reports a set patchValue when switched to literal mode with text", () => {
    const { result } = renderHook(() => useBoundOrLiteralState("field", "rating", ""));

    act(() => result.current.setMode("literal"));
    act(() => result.current.setLiteralValue("Revenue"));

    expect(result.current.dirty).toBe(true);
    expect(result.current.patchValue).toBe("Revenue");
    expect(result.current.fieldMappingValue).toBeUndefined();
  });

  it("reports patchValue null when switched from literal back to field mode", () => {
    const { result } = renderHook(() => useBoundOrLiteralState("literal", "", "Revenue"));

    act(() => result.current.setMode("field"));

    expect(result.current.dirty).toBe(true);
    expect(result.current.patchValue).toBeNull();
  });

  it("reports patchValue null when the literal text is cleared to empty", () => {
    const { result } = renderHook(() => useBoundOrLiteralState("literal", "", "Revenue"));

    act(() => result.current.setLiteralValue(""));

    expect(result.current.dirty).toBe(true);
    expect(result.current.patchValue).toBeNull();
  });

  it("reset() restores the initial mode/field/literal values", () => {
    const { result } = renderHook(() => useBoundOrLiteralState("field", "rating", ""));

    act(() => result.current.setMode("literal"));
    act(() => result.current.setLiteralValue("Revenue"));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.reset());

    expect(result.current.mode).toBe("field");
    expect(result.current.fieldValue).toBe("rating");
    expect(result.current.literalValue).toBe("");
    expect(result.current.dirty).toBe(false);
  });
});
