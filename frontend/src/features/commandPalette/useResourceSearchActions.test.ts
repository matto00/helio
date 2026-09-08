import { buildCoverageMessage } from "./useResourceSearchActions";
import type { IndexStatuses } from "./useResourceIndexing";

function statuses(overrides: Partial<IndexStatuses> = {}): IndexStatuses {
  return {
    dashboard: "succeeded",
    source: "succeeded",
    pipeline: "succeeded",
    output: "succeeded",
    ...overrides,
  };
}

describe("buildCoverageMessage — HEL-503 design.md D4 (task 4.1/4.2/4.3)", () => {
  it("returns null (no caveat) once every kind has succeeded — task 4.3", () => {
    expect(buildCoverageMessage(statuses())).toBeNull();
  });

  it("names a loading kind as still loading, distinct from a failed one — task 4.1", () => {
    const message = buildCoverageMessage(statuses({ pipeline: "loading", output: "failed" }));
    expect(message).not.toBeNull();
    expect(message).toContain("Still loading: pipelines");
    expect(message).toContain("Could not be searched: outputs");
  });

  it("treats idle the same as loading (not yet resolved)", () => {
    const message = buildCoverageMessage(statuses({ source: "idle" }));
    expect(message).toContain("Still loading: sources");
  });

  // task 4.2 — FAILABLE BY MUTATION: this is the literal guard the task prescribes. Forcing one
  // kind to `loading` and asserting it's ABSENT from the "covers" clause fails outright if
  // `buildCoverageMessage` were ever replaced by a hardcoded string (a constant obviously
  // contains every kind's label always) — run below.
  it("a kind forced to loading is ABSENT from what the message says is currently covered", () => {
    const message = buildCoverageMessage(statuses({ pipeline: "loading" }));
    expect(message).not.toBeNull();
    // "covers" clause is dashboards/sources/outputs — NOT pipelines.
    const coversClause = message!.split(".")[0];
    expect(coversClause).not.toContain("pipeline");
    expect(coversClause).toContain("dashboards");
  });
});
