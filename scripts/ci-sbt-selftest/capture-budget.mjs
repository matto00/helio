// HEL-1425: scenario (h) of scripts/ci-sbt.selftest.mjs.
import { root, tmp, backend, standIn, diag, check } from "./harness.mjs";
import {
  mkdirSync,
  writeFileSync,
  chmodSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

export default function captureBudget() {
  let r;
  // (h) budget ceiling: >= 3 verified JVMs in the recorded group, jcmd shimmed to HANG, budget 6 s. Only the
  // ci_sbt_capture call is timed, from outside the lib (date stamps taken by the calling bash, not the lib's SECONDS).
  const hangShim = join(tmp, "shim-hang");
  mkdirSync(hangShim);
  writeFileSync(
    join(hangShim, "jcmd"),
    "#!/usr/bin/env bash\ntrap '' TERM\nwhile :; do sleep 0.2; done\n",
  );
  chmodSync(join(hangShim, "jcmd"), 0o755);
  const jvmGroup = standIn(
    "jvm-group",
    `cd ${backend}\nfor i in 1 2 3 4; do java ${join(tmp, "Hang.java")} & done\nwait`,
  );
  const grp = spawn("bash", [jvmGroup], { detached: true, stdio: "ignore" });
  const gid = grp.pid;
  try {
    const javaCount = () =>
      readdirSync("/proc")
        .filter((e) => /^\d+$/.test(e))
        .filter((e) => {
          try {
            const st = readFileSync(`/proc/${e}/stat`, "utf8");
            const f = st.slice(st.lastIndexOf(") ") + 2).split(" ");
            return Number(f[2]) === gid && readlinkSync(`/proc/${e}/exe`).endsWith("/java");
          } catch {
            return false;
          }
        }).length;
    for (let i = 0; i < 300 && javaCount() < 4; i++) spawnSync("sleep", ["0.1"]);
    const jvms = javaCount();
    check("(h) setup: 4 verified JVMs in the recorded group", jvms === 4, `${jvms}`);
    const budget = 6;
    const script = `. ${join(root, "scripts", "lib", "ci-sbt-diag.sh")}
a=$(date +%s.%N); ci_sbt_capture ${gid} ${gid} ${backend} ${diag("h")}; rc=$?; b=$(date +%s.%N); echo "ELAPSED $a $b $rc"`;
    const t = performance.now();
    r = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${hangShim}:${process.env.PATH}`,
        CI_SBT_CAPTURE_BUDGET: String(budget),
      },
      timeout: 120000,
    });
    const wall = (performance.now() - t) / 1000;
    const em = r.stdout.match(/ELAPSED (\S+) (\S+) (\d+)/);
    const elapsed = em ? Number(em[2]) - Number(em[1]) : Infinity;
    check(
      `(h) capture finished within budget+1s (measured ${elapsed.toFixed(2)}s, budget ${budget}s, wall ${wall.toFixed(2)}s)`,
      elapsed <= budget + 1.0,
      r.stdout + r.stderr,
    );
    check(
      "(h) candidates with no budget left are logged as skipped",
      /skipped: capture budget exhausted/.test(r.stdout),
      r.stdout,
    );
  } finally {
    spawnSync("kill", ["-KILL", "--", `-${gid}`]);
  }
}
