import { undoSuccessToast } from "./undoToast";
import type { PatchSetUndoResponse } from "../types/patchSet";

function responseWith(
  ...sources: NonNullable<PatchSetUndoResponse["edits"][number]["inlineSources"]>
): PatchSetUndoResponse {
  return { edits: [{ index: 0, status: "restored", newId: "p", inlineSources: sources }] };
}

describe("undoSuccessToast (HEL-1493)", () => {
  it("is a plain success toast when the outcome has no inlineSources", () => {
    expect(undoSuccessToast({ edits: [{ index: 0, status: "restored" }] })).toEqual({
      variant: "success",
      message: "Undone.",
    });
  });

  it("stays a plain success toast when every inline source was removed or already gone", () => {
    const toast = undoSuccessToast(
      responseWith(
        { id: "a", name: "A", result: "removed" },
        { id: "b", name: null, result: "alreadyGone" },
      ),
    );
    expect(toast).toEqual({ variant: "success", message: "Undone." });
  });

  it("adds one line per kept source using that source's own reason, as a longer-lived warning", () => {
    const toast = undoSuccessToast(
      responseWith(
        { id: "a", name: "Sales", result: "kept", reason: "Referenced by pipeline P (p-1)." },
        { id: "b", name: "Costs", result: "kept", reason: "The data source could not be removed." },
        { id: "c", name: "Gone", result: "removed" },
      ),
    );
    expect(toast.variant).toBe("warning");
    expect(toast.duration).toBeGreaterThan(4000);
    expect(toast.message.split("\n")).toEqual([
      "Undone.",
      'Kept data source "Sales": Referenced by pipeline P (p-1).',
      'Kept data source "Costs": The data source could not be removed.',
    ]);
  });

  it("falls back to an unnamed label when the kept source has no name", () => {
    const toast = undoSuccessToast(
      responseWith({ id: "a", result: "kept", reason: "Remove each reference first." }),
    );
    expect(toast.message).toBe("Undone.\nKept a data source: Remove each reference first.");
  });

  it("renders the backend's in-use reason as one id-free line without delete-flow advice", () => {
    const toast = undoSuccessToast(
      responseWith({
        id: "430cda43-47ce-43f2-b334-7790d65a55cb",
        name: "Sales",
        result: "kept",
        reason: 'still used by pipeline "Holder of Sales", 1 you cannot access.',
      }),
    );
    expect(toast.message).toBe(
      'Undone.\nKept data source "Sales": still used by pipeline "Holder of Sales", 1 you cannot access.',
    );
    expect(toast.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(toast.message).not.toMatch(/Remove each reference/);
  });
});
