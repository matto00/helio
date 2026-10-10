// HEL-1425: scenario (a)-(c) of scripts/ci-sbt.selftest.mjs.
import {
  run,
  CI_SBT,
  backend,
  hang,
  hangWrongCwd,
  fast,
  diag,
  recordedPid,
  check,
  alive,
} from "./harness.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export default function deadline() {
  let r;
  // (a) hang: dump with the sleep frame, exit 1, recorded PID was java, group gone.
  r = run(CI_SBT, ["--deadline", "6", "--dir", backend, "--", "x"], {
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
}
