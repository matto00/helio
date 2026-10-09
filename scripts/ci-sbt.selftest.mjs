#!/usr/bin/env node
// HEL-1339 selftest for scripts/ci-sbt.sh, scripts/lib/ci-sbt-diag.sh and the die-path of scripts/e2e-backend.sh.
// Needs a JDK (jcmd) and bash, nothing from node_modules: it runs in the CI backend job (shard 0, after setup-java),
// which has no setup-node. A stand-in SBT_CMD execs `java Hang.java` (sleeps on main) in a throwaway "backend" dir.
// Process cleanup only ever signals the PIDs/PGIDs this test recorded or read from the scripts' own pgid file.
import { spawnSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  readlinkSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CI_SBT = join(root, "scripts", "ci-sbt.sh");
const E2E = join(root, "scripts", "e2e-backend.sh");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -- ${detail}`}\n`);
};
const alive = (pgid) => spawnSync("kill", ["-0", "--", `-${pgid}`]).status === 0;

const tmp = mkdtempSync(join(tmpdir(), "ci-sbt-selftest-"));
const backend = join(tmp, "backend");
const elsewhere = join(tmp, "elsewhere");
mkdirSync(backend);
mkdirSync(elsewhere);
writeFileSync(
  join(tmp, "Hang.java"),
  "public class Hang { public static void main(String[] a) throws Exception { Thread.sleep(600000); } }\n",
);
const standIn = (name, body) => {
  const p = join(tmp, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
};
const hang = standIn("sbt-hang", `exec java ${join(tmp, "Hang.java")}`);
const hangWrongCwd = standIn(
  "sbt-hang-elsewhere",
  `cd ${elsewhere}\nexec java ${join(tmp, "Hang.java")}`,
);
const fast = standIn("sbt-fast", "echo set current project to helio-backend\nexit 7");

const run = (script, args, env) =>
  spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 120000,
  });
const diag = (n) => join(tmp, `diag-${n}`);
const recordedPid = (out) => [...out.matchAll(/ci-sbt: mode=\S+ pid=(\d+) exe=(\S+)/g)].pop();

try {
  // (a) hang: dump with the sleep frame, exit 1, recorded PID was java, group gone.
  let r = run(CI_SBT, ["--deadline", "6", "--dir", backend, "--", "x"], {
    SBT_CMD: hang,
    CI_SBT_DIAG_DIR: diag("a"),
  });
  const m = recordedPid(r.stdout);
  check("(a) deadline exits 1", r.status === 1, `status ${r.status}\n${r.stdout}${r.stderr}`);
  check(
    "(a) recorded PID's exe is java (not a tee/wrapper)",
    !!m && m[2].endsWith("/java"),
    m ? m[2] : r.stdout,
  );
  const dumpFile = m && join(diag("a"), `threads-${m[1]}.txt`);
  const dump = dumpFile && existsSync(dumpFile) ? readFileSync(dumpFile, "utf8") : "";
  check(
    "(a) dump of the RECORDED pid has 'Full thread dump'",
    dump.includes("Full thread dump"),
    r.stdout,
  );
  check(
    "(a) dump shows Hang.main's sleep frame",
    /Hang\.main/.test(dump) && /Thread\.sleep/.test(dump),
    dump.slice(0, 300),
  );
  check(
    "(a) error names deadline and artifact",
    /::error::ci-sbt: .*6s.*sbt-diagnostics artifact/.test(r.stdout),
    r.stdout,
  );
  check("(a) group gone afterwards", !!m && !alive(m[1]));

  // (b) fast exit: status propagated, no dump.
  r = run(CI_SBT, ["--deadline", "30", "--dir", backend, "--", "x"], {
    SBT_CMD: fast,
    CI_SBT_DIAG_DIR: diag("b"),
  });
  check("(b) sbt status propagated", r.status === 7, `status ${r.status}`);
  check("(b) streams sbt output", r.stdout.includes("set current project to helio-backend"));
  check("(b) no dump", !readdirSync(diag("b")).some((f) => f.startsWith("threads-")));

  // (c) wrong cwd: no dump, no individual signal, group still stopped.
  r = run(CI_SBT, ["--deadline", "6", "--dir", backend, "--", "x"], {
    SBT_CMD: hangWrongCwd,
    CI_SBT_DIAG_DIR: diag("c"),
  });
  const mc = recordedPid(r.stdout);
  check("(c) exits 1", r.status === 1);
  check(
    "(c) no dump taken",
    !readdirSync(diag("c")).some((f) => f.startsWith("threads-")),
    r.stdout,
  );
  check(
    "(c) message says no dump / no individual signal",
    /NOT a JVM/.test(r.stdout) && /NO dump was taken/.test(r.stdout),
    r.stdout,
  );
  check("(c) group still stopped", !!mc && !alive(mc[1]));

  // (d) e2e-backend.sh die path: the fail-fast check (hung before compile stage) captures a dump from the PGID.
  const e2eEnv = {
    SBT_CMD: hang,
    BACKEND_DIR: backend,
    BACKEND_LOG: join(tmp, "backend.log"),
    BACKEND_PGIDFILE: join(tmp, "backend.pgid"),
    HEALTH_URL: "http://127.0.0.1:9/health",
    STAGE_TIMEOUT: "3",
    POLL: "1",
    CI_SBT_DIAG_DIR: diag("d"),
  };
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
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : "\nall ci-sbt checks passed\n");
process.exit(failed ? 1 : 0);
