// HEL-1601: the capture helper is inert unless HELIO_JEST_TIMING_DIR is set and never emits the 'agent' reporter.
const path = require("path");
const { timingReporters, REPORTER_PATH } = require("./jest-timing-capture.cjs");

describe("timingReporters", () => {
  it("returns {} when the capture directory variable is unset or empty", () => {
    expect(timingReporters("root", "/repo", {})).toEqual({});
    expect(timingReporters("root", "/repo", { HELIO_JEST_TIMING_DIR: "" })).toEqual({});
    expect(timingReporters("root", "/repo", { CI: "true" })).toEqual({});
  });

  it("lists the default reporter explicitly plus the timing reporter when set", () => {
    const cfg = timingReporters("root", "/repo", { HELIO_JEST_TIMING_DIR: "/tmp/x" });
    expect(Object.keys(cfg)).toEqual(["reporters"]);
    expect(cfg.reporters[0]).toBe("default");
    expect(cfg.reporters[1][0]).toBe(REPORTER_PATH);
    expect(cfg.reporters[1][1]).toEqual({
      dir: "/tmp/x",
      label: "root",
      repoRoot: path.resolve("/repo"),
    });
    expect(JSON.stringify(cfg)).not.toContain("agent");
  });

  it("resolves the repo root one level up for the frontend label", () => {
    const cfg = timingReporters("frontend", "/repo/frontend", { HELIO_JEST_TIMING_DIR: "/tmp/x" });
    expect(cfg.reporters[1][1].repoRoot).toBe(path.resolve("/repo"));
  });
});
