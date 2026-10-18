import { canSampleShared, sampleAccessOf, type SampleAccessInput } from "./useSourceSampleAccess";

// HEL-1648 design.md D6b: the three-state sampleability (plus the "analyze/list failed" label) per source.
const base: SampleAccessInput = {
  owned: false,
  sourcesStatus: "succeeded",
  callerRole: undefined,
  analyzeStatus: "loading",
};

describe("canSampleShared", () => {
  it("is true for owner and editor only (a viewer, or no answer yet, never samples a shared source)", () => {
    expect(canSampleShared("owner")).toBe(true);
    expect(canSampleShared("editor")).toBe(true);
    expect(canSampleShared("viewer")).toBe(false);
    expect(canSampleShared(undefined)).toBe(false);
  });
});

describe("sampleAccessOf", () => {
  it("an owned source never waits for analyze", () => {
    expect(sampleAccessOf({ ...base, owned: true })).toBe("yes");
  });

  it("a non-owned source is unknown until analyze answers", () => {
    expect(sampleAccessOf(base)).toBe("unknown");
  });

  it("an editor or owner role makes a non-owned source sampleable", () => {
    expect(sampleAccessOf({ ...base, callerRole: "editor" })).toBe("yes");
    expect(sampleAccessOf({ ...base, callerRole: "owner" })).toBe("yes");
  });

  it("the role wins over a pending or failed sources list", () => {
    expect(sampleAccessOf({ ...base, callerRole: "editor", sourcesStatus: "failed" })).toBe("yes");
    expect(sampleAccessOf({ ...base, callerRole: "editor", sourcesStatus: "idle" })).toBe("yes");
  });

  it("a viewer's non-owned source is no (no label, no request); their own is yes", () => {
    expect(sampleAccessOf({ ...base, callerRole: "viewer" })).toBe("no");
    expect(sampleAccessOf({ ...base, callerRole: "viewer", owned: true })).toBe("yes");
  });

  it("a failed sources list with no role is unavailable; a loading one is unknown", () => {
    expect(sampleAccessOf({ ...base, sourcesStatus: "failed" })).toBe("unavailable");
    expect(sampleAccessOf({ ...base, sourcesStatus: "loading" })).toBe("unknown");
    expect(sampleAccessOf({ ...base, sourcesStatus: "idle" })).toBe("unknown");
  });

  it("a rejected analyze with no result ever makes a non-owned source unavailable", () => {
    expect(sampleAccessOf({ ...base, analyzeStatus: "failed" })).toBe("unavailable");
  });

  it("a later failed re-analyze keeps the last known role", () => {
    expect(sampleAccessOf({ ...base, callerRole: "editor", analyzeStatus: "failed" })).toBe("yes");
    expect(sampleAccessOf({ ...base, callerRole: "viewer", analyzeStatus: "failed" })).toBe("no");
  });
});
