#!/usr/bin/env node
// Self-test for scripts/check-e2e-prod-build-projects.mjs (HEL-1691). Pure cases over fixtures whose shape is copied from
// real `playwright test --list --reporter=json` output (tags appear WITHOUT the `@`, tests carry `projectName`, describe
// blocks nest as `suites`). Every rule has a RED fixture that must be rejected, and clean fixtures must pass, so the check
// is failable rather than vacuous.
import assert from "node:assert/strict";
import { violations, listedTests } from "./check-e2e-prod-build-projects.mjs";

let n = 0;
function test(name, fn) {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
}

const spec = (file, title, projectName, tags = []) => ({
  title,
  ok: true,
  tags,
  tests: [
    {
      timeout: 30000,
      annotations: [],
      expectedStatus: "passed",
      projectId: projectName,
      projectName,
      results: [],
      status: "skipped",
    },
  ],
  file,
  line: 7,
  column: 5,
});
const top = (file, specs, suites = []) => ({
  title: file,
  file,
  column: 0,
  line: 0,
  specs,
  suites,
});
const doc = (...suites) => ({ config: {}, suites, errors: [], stats: {} });

const guard = top("prod-build.guard.ts", [
  spec("prod-build.guard.ts", "baseURL serves a production build", "prod-build-guard"),
]);
const burstProd = top(
  "hel1631-draft-mode.spec.ts",
  [],
  [
    {
      title: "HEL-1631 draft mode (live)",
      file: "hel1631-draft-mode.spec.ts",
      line: 160,
      column: 6,
      specs: [spec("hel1631-draft-mode.spec.ts", "a burst", "prod-build", ["prod-build"])],
    },
  ],
);
const otherDev = top("a.spec.ts", [spec("a.spec.ts", "plain", "dev")]);
const burstDev = top("hel1631-draft-mode.spec.ts", [
  spec("hel1631-draft-mode.spec.ts", "a burst", "dev", ["prod-build"]),
]);
const untaggedProd = top("b.spec.ts", [spec("b.spec.ts", "plain", "prod-build")]);

test("listedTests walks nested suites and reads projectName and tags", () => {
  const t = listedTests(doc(guard, burstProd));
  assert.deepEqual(
    t.map((x) => [x.project, x.tags]),
    [
      ["prod-build-guard", []],
      ["prod-build", ["prod-build"]],
    ],
  );
});

test("GREEN: env unset, only untagged dev tests", () => {
  assert.deepEqual(violations(doc(otherDev), false), []);
});

test("GREEN: env set, guard plus a tagged prod-build test", () => {
  assert.deepEqual(violations(doc(guard, burstProd), true), []);
});

test("RED: env unset and a @prod-build test is listed on the dev server", () => {
  const v = violations(doc(otherDev, burstDev), false);
  assert.ok(
    v.some((m) => m.includes("would run on the dev server")),
    v.join("\n"),
  );
});

test("RED: env unset and a test is listed outside project dev", () => {
  const v = violations(doc(otherDev, burstProd), false);
  assert.ok(
    v.some((m) => m.includes("outside project dev")),
    v.join("\n"),
  );
});

test("RED: env set and a dev test is listed", () => {
  const v = violations(doc(guard, burstProd, otherDev), true);
  assert.ok(
    v.some((m) => m.includes("dev test listed")),
    v.join("\n"),
  );
});

test("RED: env set and an untagged test would run in prod-build", () => {
  const v = violations(doc(guard, burstProd, untaggedProd), true);
  assert.ok(
    v.some((m) => m.includes("untagged test would run in prod-build")),
    v.join("\n"),
  );
});

test("RED: env set and only the guard is listed (the guard never counts as a prod-build test)", () => {
  const v = violations(doc(guard), true);
  assert.ok(
    v.some((m) => m.includes("no test is listed in project prod-build")),
    v.join("\n"),
  );
});

test("RED: env set and nothing is listed", () => {
  assert.ok(violations(doc(), true).length > 0);
});

test("RED: env unset and nothing is listed", () => {
  assert.ok(violations(doc(), false).length > 0);
});

test("RED: a listing with errors is refused", () => {
  assert.throws(
    () => violations({ suites: [], errors: [{ message: "boom" }] }, false),
    /reported errors/,
  );
});

console.log(`${n} e2e-prod-build-projects selftest cases passed`);
