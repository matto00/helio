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
        frontendRun: "      - run: true\n",
        backendRun: "      - run: npm run check:schemas\n",
        needs: "[frontend, security, e2e]",
      }),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
    /check:schemas/,
  );
}

// ---------------------------------------------------------------------------
// HEL-1462: ci.yml is read as parsed YAML, fail-closed.
// ---------------------------------------------------------------------------

const HOOK_SCHEMAS = `#!/usr/bin/env sh\nnpm run check:schemas\n`;
const RAW = (jobs) => `jobs:\n${jobs}`;

function caseF_commentDecoyAboveRealNeeds() {
  // The real needs drops `frontend` (the only job running the hook's check); a comment above it lists all.
  const ciYamlText = RAW(`  frontend:
    steps:
      - run: npm run check:schemas
  backend:
    steps:
      - run: true
  ci-complete:
    # needs: [frontend, backend]
    needs: [backend]
    steps:
      - run: true
`);
  expectFailure(
    "(f) a comment decoy listing the full needs above a real list dropping the hook-covering job fails",
    { hookText: HOOK_SCHEMAS, ciYamlText, packageJsonScripts: PACKAGE_SCRIPTS },
    /check:schemas/,
  );
}

function caseG_blockScalarContainingNeeds() {
  const ciYamlText = RAW(`  frontend:
    steps:
      - run: npm run check:schemas
  backend:
    steps:
      - run: |
          echo "needs: [frontend, backend]"
  ci-complete:
    needs: [backend]
    steps:
      - run: true
`);
  expectFailure(
    "(g) a block-scalar run string containing `needs: [...]` cannot stand in for the real list",
    { hookText: HOOK_SCHEMAS, ciYamlText, packageJsonScripts: PACKAGE_SCRIPTS },
    /check:schemas/,
  );
}

function expectThrowsOrErrors(name, args, reasonPattern) {
  let errors;
  try {
    ({ errors } = checkPrecommitCiParity(args));
  } catch (e) {
    errors = [String(e && e.message ? e.message : e)];
  }
  const matched = errors.filter((e) => reasonPattern.test(e));
  record(
    name,
    matched.length > 0,
    `expected an error matching ${reasonPattern}; got: ${errors.length === 0 ? "(no errors — check passed)" : errors.join(" | ")}`,
  );
}

function caseH_unparseableYaml() {
  expectThrowsOrErrors(
    "(h) unparseable ci.yml fails closed with a parse error",
    { hookText: HOOK_SCHEMAS, ciYamlText: "jobs: [\n", packageJsonScripts: PACKAGE_SCRIPTS },
    /not parseable YAML/,
  );
}

function caseI_missingCiComplete() {
  expectThrowsOrErrors(
    "(i) ci.yml without a ci-complete job fails closed",
    {
      hookText: HOOK_SCHEMAS,
      ciYamlText: RAW("  frontend:\n    steps:\n      - run: npm run check:schemas\n"),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
    /no `ci-complete` job/,
  );
}

function caseJ_scalarNeeds() {
  expectThrowsOrErrors(
    "(j) a scalar ci-complete.needs fails closed",
    {
      hookText: HOOK_SCHEMAS,
      ciYamlText: RAW(
        "  frontend:\n    steps:\n      - run: npm run check:schemas\n  ci-complete:\n    needs: frontend\n    steps:\n      - run: true\n",
      ),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
    /must be a list of job ids/,
  );
}

function caseK_commandOnlyInComment() {
  expectFailure(
    "(k) an `npm run` that appears only in a comment of a needed job does not count as coverage",
    {
      hookText: HOOK_SCHEMAS,
      ciYamlText: ciYaml({
        frontendRun: "      # - run: npm run check:schemas\n      - run: true\n",
      }),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
    /check:schemas/,
  );
}

function caseL_runOnlyInCiComplete() {
  expectPass("(l) a hook script run only by a step of ci-complete itself counts as covered", {
    hookText: HOOK_SCHEMAS,
    ciYamlText: RAW(`  frontend:
    steps:
      - run: true
  ci-complete:
    needs: [frontend]
    steps:
      - run: npm run check:schemas
`),
    packageJsonScripts: PACKAGE_SCRIPTS,
  });
}

function caseM_nullStepsStillValid() {
  expectPass(
    "(m) a needed job with an empty (null) `steps:` is valid and contributes no commands",
    {
      hookText: HOOK_SCHEMAS,
      ciYamlText: ciYaml({
        frontendRun: "      - run: npm run check:schemas\n",
        backendRun: "",
      }),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
  );
}

function caseN_nonListSteps() {
  expectThrowsOrErrors(
    "(n) a scanned job whose steps is neither null nor a list fails closed",
    {
      hookText: HOOK_SCHEMAS,
      ciYamlText: RAW(
        "  frontend:\n    steps: npm run check:schemas\n  ci-complete:\n    needs: [frontend]\n    steps:\n      - run: true\n",
      ),
      packageJsonScripts: PACKAGE_SCRIPTS,
    },
    /steps/,
  );
}

function main() {
  console.log("check-precommit-ci-parity.selftest: running fixture cases\n");
  caseA_allCoveredByName();
  caseB_bareAliasNpmTestCovered();
  caseC_indirectNodePathInvocationCovered();
  caseD_uncoveredHookScriptFails();
  caseE_coverageOutsideCiCompleteScopeDoesNotCount();
  caseF_commentDecoyAboveRealNeeds();
  caseG_blockScalarContainingNeeds();
  caseH_unparseableYaml();
  caseI_missingCiComplete();
  caseJ_scalarNeeds();
  caseK_commandOnlyInComment();
  caseL_runOnlyInCiComplete();
  caseM_nullStepsStillValid();
  caseN_nonListSteps();
  const total = passed + failed;
  console.log(`\n${passed} passed, ${failed} failed, ${total} total`);
  if (total !== 14) {
    console.error(`check-precommit-ci-parity.selftest: expected 14 cases, ran ${total} — failing.`);
    process.exit(1);
  }
  if (failed > 0) process.exit(1);
}

main();
