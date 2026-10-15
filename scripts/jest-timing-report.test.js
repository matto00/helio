// HEL-1601: the reader lists the slowest case with the overlapping load, tolerating malformed lines.
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadCapture,
  buildReport,
  formatText,
  formatMarkdown,
  main,
} = require("./jest-timing-report.cjs");

function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jest-timing-report-"));
  const c = (name, start, duration, file = "frontend/src/a.test.ts") =>
    JSON.stringify({
      type: "case",
      label: "frontend",
      file,
      name,
      status: "passed",
      duration,
      start,
      end: start + duration,
    });
  fs.writeFileSync(
    path.join(dir, "jest-timing-frontend.ndjson"),
    [
      JSON.stringify({ type: "run", label: "frontend" }),
      c("fast", 10000, 20),
      c("stalled", 20000, 1250, "frontend/src/b.test.ts"),
      "{not json",
    ].join("\n") + "\n",
  );
  const s = (t, steal, mem) =>
    JSON.stringify({
      t,
      user: 50,
      system: 10,
      iowait: 1,
      steal,
      idle: 39,
      load1: 2,
      memAvailableMb: mem,
    });
  fs.writeFileSync(
    path.join(dir, "load.ndjson"),
    [s(10000, 0, 9000), s(20500, 7, 4000), s(21000, 9, 3500), s(40000, 0, 9000)].join("\n") + "\n",
  );
  return dir;
}

describe("jest-timing-report", () => {
  it("ranks the stalled case first with the load samples that overlap it", () => {
    const report = buildReport(loadCapture(fixtureDir()), 5);
    expect(report.cases).toBe(2);
    expect(report.malformed).toBe(1);
    expect(report.slowest[0]).toMatchObject({ name: "stalled", duration: 1250 });
    expect(report.slowest[0].load).toMatchObject({
      samples: 2,
      maxSteal: 9,
      minMemAvailableMb: 3500,
    });
    expect(report.peaks.steal).toBe(9);
  });

  it("prints text and markdown including the stalled test", () => {
    const report = buildReport(loadCapture(fixtureDir()));
    expect(formatText(report)).toContain("1250 ms");
    expect(formatText(report)).toContain("frontend/src/b.test.ts :: stalled");
    expect(formatMarkdown(report)).toContain(
      "| 1250 | frontend | frontend/src/b.test.ts | stalled |",
    );
  });

  it("exits zero for a directory and 2 for bad usage", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main([fixtureDir(), "--top", "1"])).toBe(0);
      expect(main([])).toBe(2);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });

  it("takes the directory when --top is absent (the CI invocation)", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const dir = fixtureDir();
      expect(main([dir])).toBe(0);
      expect(main([dir, "--markdown"])).toBe(0);
      expect(main(["--markdown", dir])).toBe(0);
      expect(main(["--top", "1", dir])).toBe(0);
      expect(err).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });

  it("keeps a test name containing a backslash and a pipe in one markdown cell", () => {
    const name = "a \\| b | c\\\r\nd";
    const report = {
      cases: 1,
      files: 1,
      loadSamples: 0,
      malformed: 0,
      peaks: {},
      slowest: [{ label: "frontend", file: "f.test.ts", name, duration: 5, load: null }],
    };
    const row = formatMarkdown(report).split("\n").pop();
    // split on pipes that are not escaped (an odd run of preceding backslashes escapes the pipe)
    const cells = [];
    let cur = "";
    for (let i = 0; i < row.length; i++) {
      if (row[i] === "\\") {
        cur += row[i] + (row[i + 1] ?? "");
        i += 1;
      } else if (row[i] === "|") {
        cells.push(cur);
        cur = "";
      } else cur += row[i];
    }
    cells.push(cur);
    // leading and trailing "|" give an empty first and last cell: | ms | suite | file | test | load |
    expect(cells).toHaveLength(7);
    expect(row).not.toMatch(/[\r\n]/);
  });

  it("does not fail on an empty or missing directory", () => {
    const report = buildReport(loadCapture(path.join(os.tmpdir(), "does-not-exist-hel1601")));
    expect(report.cases).toBe(0);
    expect(report.slowest).toEqual([]);
  });
});
