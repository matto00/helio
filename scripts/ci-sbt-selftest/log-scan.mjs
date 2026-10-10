// HEL-1468: scenario (i) of scripts/ci-sbt.selftest.mjs -- the post-exit log scan in scripts/ci-sbt.sh.
// sbt 2 can lose forked-test events and exit 0 while ScalaTest printed a failure/abort summary. Fixtures are real
// `$LOG` forms: CI wraps the level tag and the message in SGR codes (real ESC bytes), e.g. job 114064543620 l.16698
// (`*** 1 TEST FAILED ***`) and job 113204133537 l.15702 (`*** 1 SUITE ABORTED ***`).
import { run, CI_SBT, backend, standIn, tmp, diag, check } from "./harness.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export default function logScan() {
  const E = "\u001b";
  const ansi = (msg, color = "31") =>
    `${E}[0m[${E}[0m${E}[0minfo${E}[0m] ${E}[0m${E}[0m${E}[${color}m${msg}${E}[0m${E}[0m`;
  const scanCase = (name, lines, sbtStatus) => {
    const fixture = join(tmp, `log-${name}.txt`);
    writeFileSync(fixture, lines.join("\n") + "\n");
    const sbt = standIn(`sbt-${name}`, `cat ${fixture}\nexit ${sbtStatus}`);
    return run(CI_SBT, ["--deadline", "30", "--dir", backend, "--", "x"], {
      SBT_CMD: sbt,
      CI_SBT_DIAG_DIR: diag(`i-${name}`),
    });
  };
  const unstripped =
    /^\[info\] \*\*\* ([0-9]+ (TEST|TESTS|SUITE|SUITES) (FAILED|ABORTED) \*\*\*$|RUN ABORTED)/m;
  const plain = ["[info] Tests: succeeded 0, failed 3, canceled 0, ignored 0, pending 0"];
  let r = scanCase(
    "plain",
    [...plain, "[info] *** 3 TESTS FAILED ***", "[success] elapsed time: 2 s"],
    0,
  );
  check(
    "(i) plain failed summary + sbt exit 0 -> exit 1 with ::error::",
    r.status === 1 && /::error::ci-sbt: .*\*\*\* 3 TESTS FAILED \*\*\*/.test(r.stdout),
    `status ${r.status}\n${r.stdout}`,
  );
  for (const [name, msg] of [
    ["ansi-failed", "*** 1 TEST FAILED ***"],
    ["ansi-suite", "*** 1 SUITE ABORTED ***"],
    ["ansi-run", "*** RUN ABORTED ***"],
  ]) {
    const line = ansi(msg);
    r = scanCase(name, [ansi(plain[0].slice(7), "0"), line, "[success] elapsed time: 2 s"], 0);
    check(
      `(i) ANSI-wrapped '${msg}' + sbt exit 0 -> exit 1`,
      r.status === 1 && r.stdout.includes(msg),
      `status ${r.status}\n${r.stdout}`,
    );
    check(`(i) red against an unstripped regex for '${msg}'`, !unstripped.test(line), line);
  }
  r = scanCase(
    "clean",
    [
      ansi("Tests: succeeded 12, failed 0, canceled 0, ignored 0, pending 0", "0"),
      ansi("All tests passed.", "0"),
      "[success] elapsed time: 2 s",
    ],
    0,
  );
  check("(i) clean log + exit 0 -> exit 0", r.status === 0, `status ${r.status}\n${r.stdout}`);
  r = scanCase("nonzero", ["[info] *** 3 TESTS FAILED ***"], 7);
  check(
    "(i) sbt non-zero with a failure line -> status unchanged (7), no extra error",
    r.status === 7 && !/::error::/.test(r.stdout),
    `status ${r.status}\n${r.stdout}`,
  );
}
