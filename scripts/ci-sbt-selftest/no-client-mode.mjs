// HEL-1425: scenario (e) of scripts/ci-sbt.selftest.mjs.
import { run, CI_SBT, E2E, e2eEnv, backend, fast, tmp, diag, check } from "./harness.mjs";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export default function noClientMode() {
  let r;
  // (e) the thin-client lever is gone (HEL-1362): --mode is rejected, and the e2e flag no longer selects a client.
  r = run(CI_SBT, ["--deadline", "30", "--dir", backend, "--mode", "server", "--", "x"], {
    SBT_CMD: fast,
    CI_SBT_DIAG_DIR: diag("e1"),
  });
  check(
    "(e) ci-sbt.sh rejects --mode (exit 2, unknown option)",
    r.status === 2 && /unknown option --mode/.test(r.stderr),
    `status ${r.status}\n${r.stdout}${r.stderr}`,
  );
  const eEnv = { ...e2eEnv, E2E_SBT_SERVER_FLAG: "", CI_SBT_DIAG_DIR: diag("e") };
  run(E2E, ["start"], eEnv);
  const pgidE = readFileSync(join(tmp, "backend.pgid"), "utf8").trim();
  try {
    r = run(E2E, ["wait"], eEnv);
    check(
      "(e) e2e-backend.sh ignores an emptied E2E_SBT_SERVER_FLAG (mode stays server)",
      /e2e-backend: mode=server /.test(r.stdout) && !/mode=client/.test(r.stdout),
      r.stdout,
    );
  } finally {
    spawnSync("kill", ["-KILL", "--", `-${pgidE}`]);
  }
}
