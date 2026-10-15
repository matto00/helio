// HEL-1601: the NDJSON reporter writes one parseable record per event and can never fail a run.
const fs = require("fs");
const os = require("os");
const path = require("path");
const Reporter = require("./jest-timing-reporter.cjs");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jest-timing-test-"));
}
function lines(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("JestTimingReporter", () => {
  it("writes run, case, file and done records with wall-clock start/end", () => {
    const dir = tmpDir();
    const r = new Reporter({}, { dir, label: "frontend", repoRoot: "/repo" });
    r.onRunStart();
    r.onTestCaseResult(
      { path: "/repo/frontend/src/a.test.ts" },
      { fullName: "a does x", status: "passed", duration: 1234, startedAt: 1000 },
    );
    r.onTestFileResult(
      { path: "/repo/frontend/src/a.test.ts" },
      {
        perfStats: { start: 900, end: 2300, runtime: 1400, setupFilesEnd: 950 },
        numPassingTests: 1,
        numFailingTests: 0,
        numPendingTests: 0,
      },
    );
    r.onRunComplete([], { numTotalTests: 1, numFailedTests: 0 });
    const recs = lines(path.join(dir, "jest-timing-frontend.ndjson"));
    expect(recs.map((x) => x.type)).toEqual(["run", "case", "file", "done"]);
    expect(recs[1]).toMatchObject({
      file: path.join("frontend", "src", "a.test.ts"),
      name: "a does x",
      status: "passed",
      duration: 1234,
      start: 1000,
      end: 2234,
    });
    expect(recs[1].approx).toBeUndefined();
    expect(recs[2]).toMatchObject({ start: 900, end: 2300, runtime: 1400, passed: 1 });
  });

  it("falls back to arrival time and marks approx when startedAt is missing", () => {
    const dir = tmpDir();
    const r = new Reporter({}, { dir, label: "root", repoRoot: "/repo" });
    r.onTestCaseResult(
      { path: "/repo/a.test.js" },
      { fullName: "n", status: "passed", duration: 50, startedAt: null },
    );
    const [rec] = lines(path.join(dir, "jest-timing-root.ndjson"));
    expect(rec.approx).toBe(true);
    expect(rec.end - rec.start).toBe(50);
  });

  it("disables itself with one warning when the write fails, and never throws or reports an error", () => {
    const dir = tmpDir();
    const blocker = path.join(dir, "file");
    fs.writeFileSync(blocker, "x");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = new Reporter(
        {},
        { dir: path.join(blocker, "sub"), label: "root", repoRoot: "/repo" },
      );
      expect(() => {
        r.onRunStart();
        r.onTestCaseResult(
          { path: "/repo/a" },
          { fullName: "n", status: "passed", duration: 1, startedAt: 1 },
        );
        r.onRunComplete([], {});
      }).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(r.getLastError).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});
