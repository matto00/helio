#!/usr/bin/env node
// Self-test for scripts/check-eslint-ts-rules.mjs (HEL-1448). Proves the guard is green on the
// real config and RED against the previously broken `...configs.recommended.rules` spread.
// The fixture config lives under os.tmpdir() (never in-repo) and loads its plugins through the
// repo's node_modules via createRequire.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guard = join(repoRoot, "scripts", "check-eslint-ts-rules.mjs");

let failed = 0;
function record(name, ok, detail) {
  if (!ok) {
    failed++;
    process.stderr.write(`FAIL: ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
}
const run = (...args) => spawnSync(process.execPath, [guard, ...args], { encoding: "utf8" });

// (a) real config -> green
const real = run();
record("real config passes", real.status === 0, `${real.stdout}${real.stderr}`);

// (b) the old broken spread -> red, naming the missing rule
const dir = mkdtempSync(join(tmpdir(), "eslint-ts-rules-selftest-"));
try {
  const fixture = join(dir, "eslint.config.cjs");
  writeFileSync(
    fixture,
    `const { createRequire } = require("node:module");
const req = createRequire(${JSON.stringify(join(repoRoot, "package.json"))});
const js = req("@eslint/js");
const tseslint = req("typescript-eslint");
module.exports = [
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { ...tseslint.configs.recommended.rules, "no-unused-vars": "off" },
  },
];
`,
  );
  const broken = run(fixture);
  record("broken spread is rejected", broken.status !== 0, `exit ${broken.status}`);
  record(
    "broken spread names the missing rule",
    broken.stderr.includes("@typescript-eslint/no-unused-vars"),
    broken.stderr,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// (c) a config whose TEST-file override turns a rule off must be rejected (HEL-1453). The
// fixture loads the REAL config by absolute path and appends one override.
const overrideCases = [
  {
    name: "test override turning off no-explicit-any (representative rule)",
    files: "**/*.test.{ts,tsx}",
    rule: "@typescript-eslint/no-explicit-any",
  },
  {
    name: "test override turning off no-empty-object-type (outside REQUIRED_RULES)",
    files: "**/*.test.{ts,tsx}",
    rule: "@typescript-eslint/no-empty-object-type",
  },
  {
    name: "helio-mcp-only test override turning off no-explicit-any",
    files: "helio-mcp/**/*.test.ts",
    rule: "@typescript-eslint/no-explicit-any",
  },
];
for (const { name, files, rule } of overrideCases) {
  const odir = mkdtempSync(join(tmpdir(), "eslint-ts-rules-selftest-"));
  try {
    const ofixture = join(odir, "eslint.config.cjs");
    writeFileSync(
      ofixture,
      `module.exports = [
  ...require(${JSON.stringify(join(repoRoot, "eslint.config.cjs"))}),
  { files: [${JSON.stringify(files)}], rules: { ${JSON.stringify(rule)}: "off" } },
];
`,
    );
    const res = run(ofixture);
    record(`${name} is rejected`, res.status !== 0, `exit ${res.status}`);
    record(
      `${name} names a test path and the rule`,
      res.stderr.includes(".test.") && res.stderr.includes(rule),
      res.stderr,
    );
  } finally {
    rmSync(odir, { recursive: true, force: true });
  }
}

if (failed > 0) process.exit(1);
process.stdout.write("check-eslint-ts-rules selftest: OK\n");
