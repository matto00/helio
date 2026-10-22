// HEL-1667: guard for .github/workflows/e2e-slow.yml. Reads a Playwright JSON report and exits non-zero unless at
// least one test ran, none was skipped and none failed, naming every skipped test. Usage:
//   node scripts/check-e2e-slow-results.mjs <results.json>
import { readFileSync } from "node:fs";

export function collectSkipped(suites, trail = [], out = []) {
  for (const suite of suites ?? []) {
    const here = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status === "skipped")
          out.push(`${suite.file ?? ""}: ${[...here, spec.title].join(" > ")}`);
      }
    }
    collectSkipped(suite.suites, here, out);
  }
  return out;
}

export function evaluate(report) {
  const stats = report?.stats;
  if (!stats) return ["report has no stats"];
  const problems = [];
  if (!(stats.expected > 0)) problems.push(`no test ran (expected=${stats.expected})`);
  if (stats.skipped > 0) {
    problems.push(
      `${stats.skipped} test(s) skipped:\n  ${collectSkipped(report.suites).join("\n  ")}`,
    );
  }
  if (stats.unexpected > 0) problems.push(`${stats.unexpected} test(s) failed unexpectedly`);
  return problems;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: check-e2e-slow-results.mjs <results.json>");
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`e2e-slow guard: cannot read ${path}: ${e.message}`);
    process.exit(1);
  }
  const problems = evaluate(report);
  if (problems.length > 0) {
    console.error(`e2e-slow guard FAILED:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`e2e-slow guard ok: ${report.stats.expected} test(s) ran, 0 skipped, 0 unexpected`);
}
