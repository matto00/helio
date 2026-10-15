// HEL-1601: jest reporter that appends one NDJSON record per test case / file to <dir>/jest-timing-<label>.ndjson.
// Appended incrementally so a job killed by its timeout still leaves data. It never throws and never implements
// `getLastError`, so a reporter fault cannot fail a green run: one write error logs a warning and disables it.
const fs = require("fs");
const path = require("path");

class JestTimingReporter {
  constructor(_globalConfig, options = {}) {
    this.dir = options.dir;
    this.label = options.label || "jest";
    this.repoRoot = options.repoRoot || process.cwd();
    this.enabled = Boolean(this.dir);
    this.file = this.enabled ? path.join(this.dir, `jest-timing-${this.label}.ndjson`) : null;
    if (this.enabled) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
      } catch (err) {
        this.disable(err);
      }
    }
  }

  disable(err) {
    if (!this.enabled) return;
    this.enabled = false;
    console.warn(`[jest-timing] capture disabled: ${err && err.message ? err.message : err}`);
  }

  write(record) {
    if (!this.enabled) return;
    try {
      fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`);
    } catch (err) {
      this.disable(err);
    }
  }

  rel(p) {
    return path.relative(this.repoRoot, p || "") || p;
  }

  onRunStart() {
    this.write({ type: "run", label: this.label, startedAt: Date.now(), pid: process.pid });
  }

  onTestCaseResult(test, testCaseResult) {
    const arrived = Date.now();
    const duration = Math.max(0, Number(testCaseResult.duration) || 0);
    const hasStart = typeof testCaseResult.startedAt === "number";
    const start = hasStart ? testCaseResult.startedAt : arrived - duration;
    const record = {
      type: "case",
      label: this.label,
      file: this.rel(test && test.path),
      name: testCaseResult.fullName,
      status: testCaseResult.status,
      duration,
      start,
      end: start + duration,
    };
    if (!hasStart) record.approx = true;
    this.write(record);
  }

  onTestFileResult(test, testResult) {
    const perf = testResult.perfStats || {};
    this.write({
      type: "file",
      label: this.label,
      file: this.rel(test && test.path),
      start: perf.start,
      end: perf.end,
      runtime: perf.runtime,
      setupFilesEnd: perf.setupFilesEnd,
      passed: testResult.numPassingTests,
      failed: testResult.numFailingTests,
      pending: testResult.numPendingTests,
    });
  }

  onRunComplete(_contexts, results) {
    this.write({
      type: "done",
      label: this.label,
      endedAt: Date.now(),
      numTotalTests: results && results.numTotalTests,
      numFailedTests: results && results.numFailedTests,
    });
  }
}

module.exports = JestTimingReporter;
