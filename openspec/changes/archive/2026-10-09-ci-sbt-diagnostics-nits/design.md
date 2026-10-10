## Context

See proposal.md - Why. Files (origin/main 11924a56c): `scripts/check-ci-sbt-no-pattern-kill.mjs` (65 lines, its
`logicalLines` drops comment lines and joins `\`/`|`/`||`/`&&` continuations, but a blank line ends the join),
`scripts/check-ci-sbt-no-pattern-kill.selftest.mjs` (70), `scripts/ci-sbt.selftest.mjs` (282; scenarios (a)-(h)),
`.github/workflows/ci.yml` lines 245-249 (margin comment). Only `package.json` `selftest:ci-sbt` references the
selftest; CI runs it in backend shard 0 (needs a JDK; local `java`/`jcmd` work).

## Decisions

**D1 (item 1): skip blank lines only after an operator.** Bash keeps reading after a trailing `|`, `||`, `&&` across
blank lines; after a trailing `\` the escaped newline is removed and a following blank line ENDS the command. So
blank lines are skipped only when the previous physical line continued by an operator. Replace `logicalLines` body:

```js
export function logicalLines(text) {
  const out = [];
  let cur = null;
  let afterOperator = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    if (cur && afterOperator && /^\s*$/.test(line)) return;
    const continues = !YAML_BLOCK_HEADER.test(line) && CONTINUES.test(line);
    const backslash = continues && /\\\s*$/.test(line);
    const piece = backslash ? line.replace(/\\\s*$/, "") : line;
    if (cur) cur.text += ` ${piece.trim()}`;
    else cur = { n: i + 1, text: piece };
    afterOperator = continues && !backslash;
    if (!continues) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}
```

The comment above it gains, after "(also inside a continuation).": " After a trailing `|`, `||` or `&&` (not `\`),
blank lines are skipped too, as bash does (HEL-1425)." Header line 4-5 is unchanged except appending "Blank lines
after an operator are skipped (HEL-1425)." to the HEL-1362 sentence. Alternative rejected: skip every blank line in a
continuation - wrong for `\` (would flag text bash never joins).

Selftest additions, appended right after the `"comment inside a continuation does not hide the rest"` case:

```js
// HEL-1425: bash keeps reading past blank lines after a trailing `|`/`&&`/`||`, but not after `\`.
flagsOnce("trailing | then a blank line then grep", "ps -ef |\n\n  grep sbt");
flagsOnce("trailing | then a whitespace-only line then grep", "ps -ef |\n   \n\n  grep sbt");
rec(
  "blank-line split reports the FIRST physical line number",
  /^x:1:/.test(checkText("x", "ps -ef |\n\n grep s")[0] ?? ""),
);
```
and right after the `allowsText("block header followed by a ps and then a grep line", ...)` case:
```js
allowsText("backslash then a blank line ends the command", "ps -ef \\\n\n  | grep sbt");
```
The three new flag cases are red against the old guard; the allow case is green before and after and is made
failable by mutation (`afterOperator = continues;` must turn it red).

**D2 (item 2): split by scenario, entry point unchanged.** New directory `scripts/ci-sbt-selftest/`:
- `harness.mjs`: line 1 `// HEL-1425: shared harness for scripts/ci-sbt.selftest.mjs (see that file's header).`,
  the imports it needs (`spawnSync`; `mkdtempSync, mkdirSync, writeFileSync, chmodSync`; `tmpdir`; `join, dirname`;
  `fileURLToPath`), then original lines 22-61 verbatim EXCEPT: `root` = `join(dirname(fileURLToPath(import.meta.url)),
  "..", "..")`; `let failed` stays module-private; every TOP-LEVEL `const` (original lines 22, 23, 24, 26, 30, 32,
  33, 34, 41, 47, 48, 52, 54, 60, 61) becomes `export const`, while line 42's `const p` inside `standIn` is unchanged;
  add `export const failures = () => failed;`; append original lines 124-133 as `export const e2eEnv = { ... };`.
- `deadline.mjs` = (a)(b)(c), original lines 64-121; `e2e-die.mjs` = (d), lines 123 + 134-157;
  `no-client-mode.mjs` = (e), lines 158-180; `sigquit-only.mjs` = (f)(g), lines 182-216; `capture-budget.mjs` =
  (h), lines 218-277. Each: one-line `// HEL-1425: scenario (x) of scripts/ci-sbt.selftest.mjs.` comment, then
  exactly these imports (harness = `./harness.mjs`; no others):
  - deadline: harness `{ run, CI_SBT, backend, hang, hangWrongCwd, fast, diag, recordedPid, check, alive }`;
    node:fs `{ existsSync, readFileSync, readdirSync }`; node:path `{ join }`.
  - e2e-die: harness `{ run, E2E, e2eEnv, tmp, diag, check, alive }`; node:fs `{ existsSync, readFileSync }`;
    node:child_process `{ spawnSync }`; node:path `{ join }`.
  - no-client-mode: harness `{ run, CI_SBT, E2E, e2eEnv, backend, fast, tmp, diag, check }`; node:fs
    `{ readFileSync }`; node:child_process `{ spawnSync }`; node:path `{ join }`.
  - sigquit-only: harness `{ run, CI_SBT, E2E, e2eEnv, backend, hang, tmp, diag, recordedPid, check, alive }`;
    node:fs `{ mkdirSync, writeFileSync, chmodSync, readFileSync }`; node:child_process `{ spawnSync }`; node:path
    `{ join }`.
  - capture-budget: harness `{ root, tmp, backend, standIn, diag, check }`; node:fs `{ mkdirSync, writeFileSync,
    chmodSync, readdirSync, readFileSync, readlinkSync }`; node:child_process `{ spawn, spawnSync }`; node:path
    `{ join }`.
  Then
  `export default function <name>() { let r; <lines verbatim> }` with <name> = deadline | e2eDie | noClientMode |
  sigquitOnly | captureBudget (the first `let r = run(` in (a), original line 65,
  becomes `r = run(`). No assertion, regex, name string, timeout or order changes.
- `scripts/ci-sbt.selftest.mjs` becomes the runner: original lines 1-5 header plus
  `// Scenarios live in scripts/ci-sbt-selftest/ (HEL-1425 split), run in the original (a)-(h) order.`, then
  imports `rmSync` and `{ tmp, failures }` and the five defaults, then
  `try { deadline(); e2eDie(); noClientMode(); sigquitOnly(); captureBudget(); } finally { rmSync(tmp, { recursive:
  true, force: true }); }` and the original last two lines with `failed` replaced by `failures()`.
Proof: stdout of `npm run selftest:ci-sbt` before and after, with `measured`/`wall` seconds normalised, is identical.
Alternative rejected: separate npm scripts per scenario (would change ci.yml and the CI step).

**D3 (item 3): comment only.** Replace ci.yml lines 245-249 (`# HEL-1339: sbt runs through ...` to `... about 30 s
to spare.`) with exactly:
```
        # HEL-1339: sbt runs through scripts/ci-sbt.sh: `--server` (one foreground JVM, no sbtn -> background-server
        # handoff, the suspect in two silent hangs) plus an in-step deadline (660 s; step bound 13 min) that captures
        # a thread dump of the recorded sbt JVM, uploaded as an artifact, before failing. 660 + 25 capture + 5 grace
        # < 780 s step bound. The 900 s job bound must cover pre-steps + 780 s + post-steps. HEL-1425, shard 0 of 10
        # runs 38015649444..38020588117: pre-steps (job start -> this step, incl. the 41-42 s selftest) 66-87 s;
        # post-steps (this step's end -> job end) 5-10 s, main-only saves excluded (skipped on failure). Worst
        # 87 + 780 + 10 = 877 s: about 20 s to spare, less the failure-only diagnostics upload (unmeasured; the JUnit
        # upload takes 2-3 s). A hang is normally stopped by the 660 s deadline (~690 s), far inside both bounds.
```
Measurement source: `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs` for the 10 most recent completed ci.yml
runs, job `backend (0)`. A main push that saves caches had 34 s of post-steps; those saves are `if:`-gated without
`always()`, so they are skipped when "Compile and test" fails and are excluded.

## Risks / Trade-offs

- [Operator join swallows a following YAML key] -> the "real tree is clean" selftest case still runs over ci.yml.
- [Split drifts a check] -> before/after stdout diff (D2) plus CI shard 0 running the new runner.

## Planner Notes

Self-approved: module layout (D2), comment wording (D3). Executor model is Haiku (owner-pinned): the plan is pinned.
