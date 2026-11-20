import { canRunFromUi, runRoleOf } from "./usePipelineRunRole";

// HEL-1661 (design.md D4): which run entries the pipeline page shows. The rule reads the most recent analyze RESULT,
// never the current status alone (a re-analyze sets `loading` while the previous result is kept).
const base = { isOwner: false, callerRole: undefined, analyzeStatus: null } as const;

describe("runRoleOf", () => {
  it("rule 1: the pipeline's owner is owner at once, whatever analyze is doing", () => {
    expect(runRoleOf({ ...base, isOwner: true })).toBe("owner");
    expect(runRoleOf({ ...base, isOwner: true, analyzeStatus: "loading" })).toBe("owner");
    expect(runRoleOf({ ...base, isOwner: true, callerRole: "viewer" })).toBe("owner");
  });

  it("rule 2: otherwise the last analyze result's callerRole, whatever the status is now", () => {
    for (const status of [null, "idle", "loading", "succeeded", "failed"] as const) {
      expect(runRoleOf({ ...base, callerRole: "viewer", analyzeStatus: status })).toBe("viewer");
      expect(runRoleOf({ ...base, callerRole: "editor", analyzeStatus: status })).toBe("editor");
    }
  });

  it("rule 3: no result yet and analyze idle or loading is pending", () => {
    expect(runRoleOf(base)).toBe("pending");
    expect(runRoleOf({ ...base, analyzeStatus: "idle" })).toBe("pending");
    expect(runRoleOf({ ...base, analyzeStatus: "loading" })).toBe("pending");
  });

  it("rule 4: no result and analyze failed shows the controls (the server stays the authority)", () => {
    expect(runRoleOf({ ...base, analyzeStatus: "failed" })).toBe("editor");
  });
});

describe("canRunFromUi", () => {
  it("is true for owner and editor only: a viewer and a still-pending role show no run entry", () => {
    expect(canRunFromUi("owner")).toBe(true);
    expect(canRunFromUi("editor")).toBe(true);
    expect(canRunFromUi("viewer")).toBe(false);
    expect(canRunFromUi("pending")).toBe(false);
  });
});
