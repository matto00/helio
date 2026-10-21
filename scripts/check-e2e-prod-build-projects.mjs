#!/usr/bin/env node
// HEL-1691 -- keeps the `@prod-build` partition of the e2e suite honest.
//
// `playwright.config.ts` picks the projects from HELIO_E2E_PROD_BUILD: unset -> only `dev` (no `@prod-build` test);
// set to 1 -> only `prod-build-guard` and `prod-build` (every `prod-build` test carries `@prod-build`). This check
// lists the real selection twice (`playwright test --list --reporter=json`, tests counted by `projectName`) and fails
// unless:
//   (a) env unset: every listed test is in project `dev` and none carries the `@prod-build` tag;
//   (b) env set:   no `dev` test is listed, at least one `prod-build` test is listed, and every `prod-build` test
//                  carries `@prod-build` (the untagged `prod-build-guard` setup test is counted separately and
//                  never satisfies "at least one `prod-build` test").
// A tagged test that would run on the dev server, an untagged test that would run in the prod-build job, or a
// prod-build job that selects nothing therefore all fail closed. In `--list` JSON a tag appears WITHOUT the `@`.
//
// Usage: node scripts/check-e2e-prod-build-projects.mjs   (selftest: check-e2e-prod-build-projects.selftest.mjs)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TAG = "prod-build";
const GUARD_PROJECT = "prod-build-guard";

/** Every listed test as { project, tags, title, file } from a `--list --reporter=json` document. */
export function listedTests(doc) {
  if (doc.errors?.length)
    throw new Error(`playwright --list reported errors: ${JSON.stringify(doc.errors)}`);
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        out.push({
          project: t.projectName,
          tags: spec.tags ?? [],
          title: spec.title,
          file: spec.file ?? suite.file,
        });
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of doc.suites ?? []) walk(s);
  return out;
}

/** Returns a list of violation strings (empty = clean). `prodBuildEnv` is whether HELIO_E2E_PROD_BUILD=1 was set. */
export function violations(doc, prodBuildEnv) {
  const tests = listedTests(doc);
  const bad = [];
  const where = (t) => `${t.file} "${t.title}" [${t.project}]`;
  if (!prodBuildEnv) {
    if (tests.length === 0) bad.push("env unset: no tests listed at all");
    for (const t of tests) {
      if (t.project !== "dev") bad.push(`env unset: test outside project dev: ${where(t)}`);
      if (t.tags.includes(TAG))
        bad.push(`env unset: @${TAG} test would run on the dev server: ${where(t)}`);
    }
  } else {
    const prod = tests.filter((t) => t.project === "prod-build");
    for (const t of tests) {
      if (t.project === "dev") bad.push(`env set: dev test listed: ${where(t)}`);
      else if (t.project !== "prod-build" && t.project !== GUARD_PROJECT)
        bad.push(`env set: unknown project: ${where(t)}`);
    }
    if (prod.length === 0)
      bad.push("env set: no test is listed in project prod-build (only the guard, or nothing)");
    for (const t of prod) {
      if (!t.tags.includes(TAG))
        bad.push(`env set: untagged test would run in prod-build: ${where(t)}`);
    }
  }
  return bad;
}

function list(env) {
  const r = spawnSync("npx", ["playwright", "test", "--list", "--reporter=json"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, HELIO_E2E_PROD_BUILD: env },
  });
  if (r.status !== 0) throw new Error(`playwright --list failed (exit ${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const unset = violations(list(""), false);
    const set = violations(list("1"), true);
    const all = [...unset, ...set];
    if (all.length) {
      console.error(
        `e2e prod-build partition check FAILED:\n${all.map((v) => `  - ${v}`).join("\n")}`,
      );
      process.exit(1);
    }
    console.log(
      "e2e prod-build partition check: clean (env unset -> dev only; env set -> guard + tagged prod-build only)",
    );
  } catch (e) {
    console.error(`e2e prod-build partition check: ${e.message}`);
    process.exit(1);
  }
}
