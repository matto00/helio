// HEL-1425: scenario (f)-(g) of scripts/ci-sbt.selftest.mjs.
import {
  run,
  CI_SBT,
  E2E,
  e2eEnv,
  backend,
  hang,
  tmp,
  diag,
  recordedPid,
  check,
  alive,
} from "./harness.mjs";
import { mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export default function sigquitOnly() {
  let r;
  // (f) SIGQUIT-only: jcmd shimmed (this spawn's PATH only) to fail, so the capture can only send SIGQUIT.
  const shim = join(tmp, "shim-fail");
  mkdirSync(shim);
  writeFileSync(
    join(shim, "jcmd"),
    "#!/usr/bin/env bash\necho 'jcmd: shimmed failure' >&2\nexit 1\n",
  );
  chmodSync(join(shim, "jcmd"), 0o755);
  const shimEnv = { PATH: `${shim}:${process.env.PATH}` };
  r = run(CI_SBT, ["--deadline", "6", "--dir", backend, "--", "x"], {
    ...shimEnv,
    SBT_CMD: hang,
    CI_SBT_DIAG_DIR: diag("f"),
  });
  const mf = recordedPid(r.stdout);
  check("(f) ci-sbt.sh: deadline exits 1", r.status === 1, `status ${r.status}`);
  check(
    "(f) ci-sbt.sh: message says SIGQUIT sent, not 'thread dump captured'",
    /::error::.*SIGQUIT was sent/.test(r.stdout) && !/thread dump captured/.test(r.stdout),
    r.stdout,
  );
  check("(f) ci-sbt.sh: group still stopped", !!mf && !alive(mf[1]));
  const fEnv = { ...e2eEnv, ...shimEnv, CI_SBT_DIAG_DIR: diag("g") };
  run(E2E, ["start"], fEnv);
  const pgidG = readFileSync(join(tmp, "backend.pgid"), "utf8").trim();
  try {
    r = run(E2E, ["wait"], fEnv);
    check(
      "(g) e2e-backend.sh die: stderr says SIGQUIT sent (not 'no verified JVM')",
      r.status === 1 && /SIGQUIT was sent/.test(r.stderr) && !/no verified JVM/.test(r.stderr),
      `status ${r.status}\n${r.stderr}`,
    );
  } finally {
    spawnSync("kill", ["-KILL", "--", `-${pgidG}`]);
  }
}
