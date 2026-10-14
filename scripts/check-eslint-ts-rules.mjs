#!/usr/bin/env node
// HEL-1448: fails when the typescript-eslint recommended rule set is not actually active for
// TS files. The root config once spread `tseslint.configs.recommended.rules` — `recommended` is
// an ARRAY of config entries, so `.rules` was undefined and ZERO @typescript-eslint rules ran
// for years while lint stayed green. This guard asks ESLint for the COMPUTED config of a
// representative .ts and .tsx path in each linted package and lints a probe snippet.
//
// Usage: node scripts/check-eslint-ts-rules.mjs [path/to/eslint.config.cjs]
// The optional config path lets the selftest aim it at a fixture config.

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { ESLint } = createRequire(resolve(repoRoot, "package.json"))("eslint");

const configArg = process.argv[2];
const eslint = new ESLint({
  cwd: repoRoot,
  ...(configArg ? { overrideConfigFile: resolve(configArg) } : {}),
});

const PACKAGE_PATHS = [
  "frontend/src/__guard__.ts",
  "frontend/src/__guard__.tsx",
  "helio-mcp/src/__guard__.ts",
  "e2e/__guard__.ts",
  "e2e/__guard__.tsx",
];
// Representative recommended rules that must be severity "error" for every TS path.
const REQUIRED_RULES = [
  "@typescript-eslint/no-unused-vars",
  "@typescript-eslint/no-explicit-any",
  "@typescript-eslint/ban-ts-comment",
  "@typescript-eslint/no-require-imports",
];
// HEL-1453: test-file paths, each paired with its non-test baseline in the same package. Every
// @typescript-eslint rule that is an error on the baseline must also be an error on the test path.
const TEST_PATH_PAIRS = [
  ["frontend/src/__guard__.test.ts", "frontend/src/__guard__.ts"],
  ["frontend/src/__guard__.test.tsx", "frontend/src/__guard__.tsx"],
  ["frontend/src/test/__guard__.ts", "frontend/src/__guard__.ts"],
  ["helio-mcp/src/__guard__.test.ts", "helio-mcp/src/__guard__.ts"],
  ["e2e/__guard__.spec.ts", "e2e/__guard__.ts"],
];
// The one intentional test-only exemption in eslint.config.cjs: jest tests may use require().
// An exact (test path, rule) allowance; anything else turned off for a test path fails the guard.
const TEST_ONLY_ALLOWANCES = new Map([
  ["frontend/src/__guard__.test.ts", new Set(["@typescript-eslint/no-require-imports"])],
  ["frontend/src/__guard__.test.tsx", new Set(["@typescript-eslint/no-require-imports"])],
  ["frontend/src/test/__guard__.ts", new Set(["@typescript-eslint/no-require-imports"])],
  ["helio-mcp/src/__guard__.test.ts", new Set(["@typescript-eslint/no-require-imports"])],
]);
const PROBE = 'import { unused } from "x";\nexport const a: any = 1;\n';

const severityOf = (entry) => (Array.isArray(entry) ? entry[0] : entry);
const isError = (s) => s === 2 || s === "error";

const failures = [];
for (const path of PACKAGE_PATHS) {
  const config = await eslint.calculateConfigForFile(resolve(repoRoot, path));
  const rules = config?.rules ?? {};
  for (const rule of REQUIRED_RULES) {
    if (!isError(severityOf(rules[rule]))) {
      failures.push(`${path}: ${rule} is not active as an error`);
    }
  }
}
for (const [testPath, basePath] of TEST_PATH_PAIRS) {
  const baseRules = (await eslint.calculateConfigForFile(resolve(repoRoot, basePath)))?.rules ?? {};
  const testRules = (await eslint.calculateConfigForFile(resolve(repoRoot, testPath)))?.rules ?? {};
  const allowed = TEST_ONLY_ALLOWANCES.get(testPath) ?? new Set();
  for (const rule of Object.keys(baseRules)) {
    if (!rule.startsWith("@typescript-eslint/")) continue;
    if (!isError(severityOf(baseRules[rule]))) continue;
    if (allowed.has(rule)) continue;
    if (!isError(severityOf(testRules[rule]))) {
      failures.push(`${testPath}: ${rule} is an error on ${basePath} but not on the test path`);
    }
  }
}
const [probeResult] = await eslint.lintText(PROBE, {
  filePath: resolve(repoRoot, "frontend/src/__guard__.ts"),
});
const probeIds = new Set((probeResult?.messages ?? []).map((m) => m.ruleId));
for (const rule of ["@typescript-eslint/no-unused-vars", "@typescript-eslint/no-explicit-any"]) {
  if (!probeIds.has(rule)) failures.push(`probe snippet did not trigger ${rule}`);
}

const [testProbe] = await eslint.lintText(PROBE, {
  filePath: resolve(repoRoot, "frontend/src/__guard__.test.ts"),
});
const testProbeIds = new Set((testProbe?.messages ?? []).map((m) => m.ruleId));
for (const rule of ["@typescript-eslint/no-unused-vars", "@typescript-eslint/no-explicit-any"]) {
  if (!testProbeIds.has(rule)) failures.push(`test-path probe snippet did not trigger ${rule}`);
}

if (failures.length > 0) {
  process.stderr.write(
    `check-eslint-ts-rules FAILED — the typescript-eslint recommended set is inactive:\n${failures
      .map((f) => `  - ${f}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write("check-eslint-ts-rules: OK\n");
