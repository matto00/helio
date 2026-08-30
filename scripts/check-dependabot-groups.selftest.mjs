#!/usr/bin/env node
// Self-test for scripts/check-dependabot-groups.mjs. Drives the exported
// check against in-memory fixture configs and manifests -- no disk, no git,
// no subprocess -- and asserts on the REASON text of each failure, never on
// a non-zero result alone: every negative case would "fail" for any reason,
// including a crash, so an exit-code-only assertion would accept a broken
// check. Case (f) is the coverage control, so each case is named on stdout
// individually rather than summarised as a pass count.
//
// Follows the check-openspec-hygiene.selftest.mjs convention: a standalone
// script, not a jest test (the jest gate is vacuous inside a worktree —
// HEL-880 — which is exactly where these gates are verified).

import { checkDependabotGroups } from "./check-dependabot-groups.mjs";

const FAMILIES = [
  {
    name: "fortawesome",
    ecosystem: "npm",
    directory: "/frontend",
    members: ["@fortawesome/fontawesome-svg-core", "@fortawesome/free-solid-svg-icons"],
  },
  {
    name: "react",
    ecosystem: "npm",
    directory: "/frontend",
    members: ["react", "react-dom", "@types/react"],
  },
];

const INDEPENDENTS = [{ ecosystem: "npm", directory: "/frontend", packages: ["axios"] }];

const MANIFEST = {
  dependencies: {
    "@fortawesome/fontawesome-svg-core": "^7.2.0",
    "@fortawesome/free-solid-svg-icons": "^7.2.0",
    react: "^19.1.1",
    "react-dom": "^19.1.1",
    axios: "^1.18.0",
  },
  devDependencies: { "@types/react": "^19.0.0", typescript: "^5.9.3" },
};

const manifests = (manifest = MANIFEST) => ({ "npm:/frontend": manifest });

function config(groupsYaml) {
  return `version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 15
    labels: ["dependencies"]
    groups:
${groupsYaml}
`;
}

const FORTAWESOME_GROUP = `      fortawesome:
        patterns:
          - "@fortawesome/fontawesome-svg-core"
          - "@fortawesome/free-solid-svg-icons"
`;
const REACT_GROUP = `      react:
        patterns:
          - "react"
          - "react-dom"
          - "@types/react*"
`;
const DEV_CATCH_ALL = `      dev-dependencies:
        dependency-type: "development"
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
  const { errors } = checkDependabotGroups(args);
  const matched = errors.filter((e) => reasonPattern.test(e));
  record(
    name,
    matched.length > 0,
    `expected an error matching ${reasonPattern}; got: ${errors.length === 0 ? "(no errors — check passed)" : errors.join(" | ")}`,
  );
}

function expectPass(name, args) {
  const { errors } = checkDependabotGroups(args);
  record(name, errors.length === 0, `expected no errors; got: ${errors.join(" | ")}`);
}

function caseA_ungroupedFamily() {
  expectFailure(
    "(a) ungrouped family -> fails naming the family as split/ungrouped",
    {
      configText: config(REACT_GROUP + DEV_CATCH_ALL),
      manifests: manifests(),
      families: FAMILIES,
      independents: INDEPENDENTS,
    },
    /family "fortawesome" is split\/ungrouped/,
  );
}

function caseB_splitAcrossTwoGroups() {
  const split = `      fortawesome-core:
        patterns:
          - "@fortawesome/fontawesome-svg-core"
      fortawesome-icons:
        patterns:
          - "@fortawesome/free-solid-svg-icons"
`;
  expectFailure(
    "(b) family split across two groups -> fails naming both groups",
    {
      configText: config(split + REACT_GROUP + DEV_CATCH_ALL),
      manifests: manifests(),
      families: FAMILIES,
      independents: INDEPENDENTS,
    },
    /family "fortawesome" is split across 2 groups \(fortawesome-core, fortawesome-icons\)/,
  );
}

function caseC_catchAllDeclaredFirst() {
  expectFailure(
    "(c) dev catch-all declared before the react pattern group captures @types/react*",
    {
      configText: config(DEV_CATCH_ALL + FORTAWESOME_GROUP + REACT_GROUP),
      manifests: manifests(),
      families: FAMILIES,
      independents: INDEPENDENTS,
    },
    /family "react" is split across 2 groups .*@types\/react -> dev-dependencies/,
  );
}

function caseD_staleDeclaration() {
  const families = [
    ...FAMILIES,
    {
      name: "ghost",
      ecosystem: "npm",
      directory: "/frontend",
      members: ["@fortawesome/fontawesome-svg-core", "package-that-was-removed"],
    },
  ];
  expectFailure(
    "(d) declared member absent from the manifest -> fails as a stale declaration",
    {
      configText: config(FORTAWESOME_GROUP + REACT_GROUP + DEV_CATCH_ALL),
      manifests: manifests(),
      families,
      independents: INDEPENDENTS,
    },
    /declared member "package-that-was-removed" is not in \/frontend\/package\.json — stale declaration/,
  );
}

function caseE_uncoveredManifestPackage() {
  const manifest = {
    ...MANIFEST,
    dependencies: { ...MANIFEST.dependencies, "react-grid-layout": "^2.2.2" },
  };
  expectFailure(
    "(e) production package on neither the family table nor the independent allowlist -> fails naming it",
    {
      configText: config(FORTAWESOME_GROUP + REACT_GROUP + DEV_CATCH_ALL),
      manifests: manifests(manifest),
      families: FAMILIES,
      independents: INDEPENDENTS,
    },
    /unaccounted production dependency "react-grid-layout"/,
  );
}

function caseF_fullyGroupedAndCovered() {
  expectPass("(f) grouped, correctly ordered, fully covered -> passes", {
    configText: config(FORTAWESOME_GROUP + REACT_GROUP + DEV_CATCH_ALL),
    manifests: manifests(),
    families: FAMILIES,
    independents: INDEPENDENTS,
  });
}

function main() {
  console.log("check-dependabot-groups.selftest: running fixture cases\n");
  caseA_ungroupedFamily();
  caseB_splitAcrossTwoGroups();
  caseC_catchAllDeclaredFirst();
  caseD_staleDeclaration();
  caseE_uncoveredManifestPackage();
  caseF_fullyGroupedAndCovered();
  const total = passed + failed;
  console.log(`\n${passed} passed, ${failed} failed, ${total} total`);
  if (total !== 6) {
    console.error(`check-dependabot-groups.selftest: expected 6 cases, ran ${total} — failing.`);
    process.exit(1);
  }
  if (failed > 0) process.exit(1);
}

main();
