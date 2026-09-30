import { humanise, lastRunState, stepKindLabel } from "./provenanceLabels";

describe("provenanceLabels", () => {
  it("maps a known op kind through the pipeline UI's own label", () => {
    expect(stepKindLabel("filter")).toBe("Filter rows");
    expect(stepKindLabel("aggregate")).toBe("Group & aggregate");
  });

  it("falls back to a humanised string for a kind absent from OP_TYPES (join)", () => {
    expect(stepKindLabel("join")).toBe("Join");
    expect(humanise("some_new-kind")).toBe("Some new kind");
  });

  it("classifies the last run", () => {
    expect(lastRunState(null)).toBe("never");
    expect(lastRunState({ status: "succeeded", completedAt: null, rowCount: null })).toBe(
      "succeeded",
    );
    expect(lastRunState({ status: "failed", completedAt: null, rowCount: null })).toBe("failed");
    expect(lastRunState({ status: "running", completedAt: null, rowCount: null })).toBe("running");
    expect(lastRunState({ status: "queued", completedAt: null, rowCount: null })).toBe("running");
  });
});
