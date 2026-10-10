// HEL-1425: shared harness for scripts/ci-sbt.selftest.mjs (see that file's header).
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CI_SBT = join(root, "scripts", "ci-sbt.sh");
export const E2E = join(root, "scripts", "e2e-backend.sh");
let failed = 0;
export const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -- ${detail}`}\n`);
};
export const alive = (pgid) => spawnSync("kill", ["-0", "--", `-${pgid}`]).status === 0;

export const tmp = mkdtempSync(join(tmpdir(), "ci-sbt-selftest-"));
export const backend = join(tmp, "backend");
export const elsewhere = join(tmp, "elsewhere");
mkdirSync(backend);
mkdirSync(elsewhere);
writeFileSync(
  join(tmp, "Hang.java"),
  "public class Hang { public static void main(String[] a) throws Exception { Thread.sleep(600000); } }\n",
);
export const standIn = (name, body) => {
  const p = join(tmp, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
};
export const hang = standIn("sbt-hang", `exec java ${join(tmp, "Hang.java")}`);
export const hangWrongCwd = standIn(
  "sbt-hang-elsewhere",
  `cd ${elsewhere}\nexec java ${join(tmp, "Hang.java")}`,
);
export const fast = standIn("sbt-fast", "echo set current project to helio-backend\nexit 7");

export const run = (script, args, env) =>
  spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 120000,
  });
export const diag = (n) => join(tmp, `diag-${n}`);
export const recordedPid = (out) =>
  [...out.matchAll(/ci-sbt: mode=\S+ pid=(\d+) exe=(\S+)/g)].pop();

export const failures = () => failed;

export const e2eEnv = {
  SBT_CMD: hang,
  BACKEND_DIR: backend,
  BACKEND_LOG: join(tmp, "backend.log"),
  BACKEND_PGIDFILE: join(tmp, "backend.pgid"),
  HEALTH_URL: "http://127.0.0.1:9/health",
  STAGE_TIMEOUT: "3",
  POLL: "1",
  CI_SBT_DIAG_DIR: diag("d"),
};
