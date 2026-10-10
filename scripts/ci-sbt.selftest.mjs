#!/usr/bin/env node
// HEL-1339 selftest for scripts/ci-sbt.sh, scripts/lib/ci-sbt-diag.sh and the die-path of scripts/e2e-backend.sh.
// Needs a JDK (jcmd) and bash, nothing from node_modules: it runs in the CI backend job (shard 0, after setup-java),
// which has no setup-node. A stand-in SBT_CMD execs `java Hang.java` (sleeps on main) in a throwaway "backend" dir.
// Process cleanup only ever signals the PIDs/PGIDs this test recorded or read from the scripts' own pgid file.
// Scenarios live in scripts/ci-sbt-selftest/ (HEL-1425 split), run in the original (a)-(h) order, then (i) (HEL-1468).
import { rmSync } from "node:fs";
import { tmp, failures } from "./ci-sbt-selftest/harness.mjs";
import deadline from "./ci-sbt-selftest/deadline.mjs";
import e2eDie from "./ci-sbt-selftest/e2e-die.mjs";
import noClientMode from "./ci-sbt-selftest/no-client-mode.mjs";
import sigquitOnly from "./ci-sbt-selftest/sigquit-only.mjs";
import captureBudget from "./ci-sbt-selftest/capture-budget.mjs";
import logScan from "./ci-sbt-selftest/log-scan.mjs";

try {
  deadline();
  e2eDie();
  noClientMode();
  sigquitOnly();
  captureBudget();
  logScan();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.stdout.write(
  failures() ? `\n${failures()} check(s) FAILED\n` : "\nall ci-sbt checks passed\n",
);
process.exit(failures() ? 1 : 0);
