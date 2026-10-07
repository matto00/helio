#!/usr/bin/env node
// Self-test for scripts/check-e2e-evidence-paths.mjs (HEL-1363). Runs the guard as a real child
// process against fixture trees and proves every violation shape is red and every clean shape green,
// plus that the repository itself is clean after migration.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const guard = join(dirname(fileURLToPath(import.meta.url)), "check-e2e-evidence-paths.mjs");
const repoRoot = join(dirname(guard), "..");
const fixtures = [];
let passed = 0;
let failed = 0;

function record(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    process.stderr.write(`FAIL: ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
}

function run(root) {
  const res = spawnSync("node", [guard, root], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function fixture(source) {
  const root = mkdtempSync(join(tmpdir(), "e2e-evidence-selftest-"));
  fixtures.push(root);
  mkdirSync(join(root, "e2e"), { recursive: true });
  writeFileSync(join(root, "e2e/fixture.spec.ts"), source);
  return root;
}

function red(name, source, expectLine) {
  const res = run(fixture(source));
  record(
    `red: ${name}`,
    res.status === 1 && res.stderr.includes(`e2e/fixture.spec.ts:${expectLine}:`),
    `status=${res.status} stderr=${res.stderr}`,
  );
}

function green(name, source) {
  const res = run(fixture(source));
  record(`green: ${name}`, res.status === 0, `status=${res.status} stderr=${res.stderr}`);
}

function main() {
  try {
    red(
      "change-dir resolve path",
      'await page.screenshot({ path: resolve(__dirname, "../openspec/changes/x/screenshots/a.png") });\n',
      1,
    );
    red(
      "cwd-relative string",
      'const a = 1;\nawait page.screenshot({ path: ".concertino/runs/HEL-1/evidence/a.png" });\n',
      2,
    );
    red(
      "cwd-relative template literal (multi-line call)",
      "await page.screenshot({\n  path: `.concertino/runs/HEL-1/evidence/a-${t}.png`,\n});\n",
      1,
    );
    red(
      "indirection through a variable",
      'const p = "a.png";\nawait page.screenshot({ path: p });\n',
      2,
    );
    red("shorthand path", "await page.screenshot({ path });\n", 1);
    red("spread in screenshot options", "const a = 1;\nawait page.screenshot({ ...shot });\n", 2);
    red("non-literal options", "await page.screenshot(opts);\n", 1);
    red("openspec/changes in a non-comment string", 'const d = "openspec/changes/foo";\n', 1);
    red(
      "mkdirSync under openspec/specs",
      'const a = 1;\nmkdirSync(resolve(__dirname, "../openspec/specs/foo/screenshots"), { recursive: true });\n',
      2,
    );
    red(
      "writeFileSync under openspec/specs",
      'const a = 1;\nwriteFileSync(resolve(__dirname, "../openspec/specs/foo/a.png"), buf);\n',
      2,
    );
    red(
      "openspec as a standalone path segment",
      'const a = 1;\nconst d = join(__dirname, "..", "openspec", "changes", "x");\n',
      2,
    );
    green(
      "openspec/changes only in comments",
      '// writes to openspec/changes/x are forbidden\n/* openspec/changes\n   again */\nconst a = "http://example.com";\n',
    );
    green(
      "helper call over multiple lines",
      'await page.screenshot({\n  path: evidencePath("HEL-1", `a-${t}.png`),\n  fullPage: true,\n});\n',
    );
    green("screenshot with no path (buffer)", "const buf = await page.screenshot();\n");
    green(
      "reviewed escape hatch",
      'await page.screenshot({ path: "x.png" }); // e2e-evidence-path: reviewed — fixture\n',
    );
    const real = run(repoRoot);
    record("green: the repository itself is clean", real.status === 0, real.stderr);
  } finally {
    for (const dir of fixtures) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0 || passed === 0) process.exit(1);
}

main();
