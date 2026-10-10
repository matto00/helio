// HEL-1425: scenario (d) of scripts/ci-sbt.selftest.mjs.
import { run, E2E, e2eEnv, tmp, diag, check, alive } from "./harness.mjs";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export default function e2eDie() {
  let r;
  // (d) e2e-backend.sh die path: the fail-fast check (hung before compile stage) captures a dump from the PGID.
  run(E2E, ["start"], e2eEnv);
  const pgid = readFileSync(join(tmp, "backend.pgid"), "utf8").trim();
  try {
    r = run(E2E, ["wait"], e2eEnv);
    const d = join(diag("d"), `threads-${pgid}.txt`);
    check(
      "(d) wait fails fast",
      r.status === 1 && /hung before the compile\/run stage/.test(r.stderr),
      `status ${r.status}\n${r.stderr}`,
    );
    check(
      "(d) die captured a dump of the recorded PGID's JVM",
      existsSync(d) && readFileSync(d, "utf8").includes("Full thread dump"),
      r.stderr,
    );
    check("(d) die does not stop the group (backend outlives start)", alive(pgid));
    check(
      "(d) mode line says server (default flag)",
      /e2e-backend: mode=server /.test(r.stdout),
      r.stdout,
    );
  } finally {
    spawnSync("kill", ["-KILL", "--", `-${pgid}`]); // the PGID this test recorded
  }
}
