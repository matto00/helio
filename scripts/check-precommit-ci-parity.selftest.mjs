#!/usr/bin/env node
// Self-test for scripts/check-precommit-ci-parity.mjs. Drives the exported
// check against in-memory fixture hook/ci.yml/package.json text -- no disk,
// no git, no subprocess -- and asserts on the REASON text of each failure,
// never on a non-zero result alone (an assertion-only check would also
// "fail" for a crash). Follows the check-dependabot-groups.selftest.mjs
// convention: a standalone script, not a jest test (jest is vacuous inside a
// worktree -- HEL-880 -- which is exactly where these gates are verified).

import { checkPrecommitCiParity } from "./check-precommit-ci-parity.mjs";

const PACKAGE_SCRIPTS = {
  lint: "eslint . --max-warnings=0",
  typecheck: "npm --prefix frontend run typecheck",
  "format:check": "prettier . --check",
  "check:repo-integrity": "node scripts/check-repo-integrity.mjs",
  "check:scala-quality": "node scripts/check-scala-quality.mjs",
  "check:schemas": "node scripts/check-schema-drift.mjs",
  "check:spec-structure": "node scripts/check-spec-structure.mjs",
  "check:does-not-exist-in-ci": "node scripts/check-does-not-exist-in-ci.mjs",
  test: "jest && npm --prefix frontend test",
};

function ciYaml({ frontendRun, backendRun = "", needs = "[frontend, backend, security, e2e]" }) {
  return `jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
${frontendRun}
  backend:
    runs-on: ubuntu-latest
    steps:
${backendRun}
  security:
    runs-on: ubuntu-latest
    steps:
      - run: true
  e2e:
    runs-on: ubuntu-latest
    steps:
      - run: true
  ci-complete:
    if: always()
    needs: ${needs}
    steps:
      - run: true
`;
}

const FRONTEND_STEPS_FULL = `      - run: npm run lint
      - run: npm run typecheck
      - run: npm run format:check
      - run: npm run check:repo-integrity
      - run: npm run check:scala-quality
      - run: npm run check:schemas
      - run: npm run check:spec-structure
      - run: npm test
`;

let passed = 0;
let failed = 0;

function record(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail) console.log(`        ${detail}`);
  }
}

function expectFailure(name, args, reasonPattern) {
  const { errors } = checkPrecommitCiParity(args);
  const matched = errors.filter((e) => reasonPattern.test(e));
  record(
    name,
    matched.length > 0,
    `expected an error matching ${reasonPattern}; got: ${errors.length === 0 ? "(no errors — check passed)" : errors.join(" | ")}`,
  );
}

function expectPass(name, args) {
  const { errors } = checkPrecommitCiParity(args);
  record(name, errors.length === 0, `expected no errors; got: ${errors.join(" | ")}`);
}

function caseA_allCoveredByName() {
  expectPass("(a) every hook script covered by an npm-run-name step in ci-complete's scope", {
    hookText: `#!/usr/bin/env sh
npm run lint
npm run typecheck
npm run format:check
npm run check:repo-integrity
npm run check:scala-quality
npm run check:schemas
npm run check:spec-structure
npm test
`,
    ciYamlText: ciYaml({ frontendRun: FRONTEND_STEPS_FULL }),
    packageJsonScripts: PACKAGE_SCRIPTS,
  });
}

function caseB_bareAliasNpmTestCovered() {
  expectPass(
    "(b) bare-alias `npm test` line in the hook is recognized and matched by CI's `npm test`",
    {
      hookText: `#!/usr/bin/env sh
npm run lint
npm test
`,
      ciYamlText: ciYaml({ frontendRun: "      - run: npm run lint\n      - run: npm test\n" }),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
  );
}

function caseC_indirectNodePathInvocationCovered() {
  expectPass(
    "(c) CI invoking the underlying `node <path>` directly (not the npm-script name) still counts",
    {
      hookText: `#!/usr/bin/env sh
npm run check:schemas
`,
      ciYamlText: ciYaml({
        frontendRun: "      - run: node scripts/check-schema-drift.mjs\n",
      }),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
  );
}

function caseD_uncoveredHookScriptFails() {
  expectFailure(
    "(d) a hook script absent from ci-complete's scope fails, naming it",
    {
      hookText: `#!/usr/bin/env sh
npm run lint
npm run check:does-not-exist-in-ci
`,
      ciYamlText: ciYaml({ frontendRun: "      - run: npm run lint\n" }),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
    /check:does-not-exist-in-ci/,
  );
}

function caseE_coverageOutsideCiCompleteScopeDoesNotCount() {
  expectFailure(
    "(e) a check running only in a job NOT in ci-complete's needs does not count as coverage",
    {
      hookText: `#!/usr/bin/env sh
npm run check:schemas
`,
      // check:schemas only runs in `backend`, which is deliberately absent
      // from ci-complete's needs here -- mirrors a tag-triggered workflow
      // that blocks nothing on a PR.
      ciYamlText: ciYaml({
        backendRun: "      - run: npm run check:schemas\n",
        needs: "[frontend, security, e2e]",
      }),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
    /check:schemas/,
  );
}

function main() {
  console.log("check-precommit-ci-parity.selftest: running fixture cases\n");
  caseA_allCoveredByName();
  caseB_bareAliasNpmTestCovered();
  caseC_indirectNodePathInvocationCovered();
  caseD_uncoveredHookScriptFails();
  caseE_coverageOutsideCiCompleteScopeDoesNotCount();
  const total = passed + failed;
  console.log(`\n${passed} passed, ${failed} failed, ${total} total`);
  if (total !== 5) {
    console.error(`check-precommit-ci-parity.selftest: expected 5 cases, ran ${total} — failing.`);
    process.exit(1);
  }
  if (failed > 0) process.exit(1);
}

main();
