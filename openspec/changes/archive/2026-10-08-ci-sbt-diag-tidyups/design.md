## Context

See proposal.md. Files: `scripts/ci-sbt.sh` (backend/security sbt runs), `scripts/e2e-backend.sh` (e2e backend start),
`scripts/lib/ci-sbt-diag.sh` (shared capture, sourced by both), `scripts/check-ci-sbt-no-pattern-kill.mjs` (+ selftest,
frontend job), `scripts/ci-sbt.selftest.mjs` (backend shard 0, needs a JDK). Premise re-derived on origin/main b0ff8570:
all six HEL-1362 items still apply (evidence: `.concertino/runs/HEL-1362/evidence/premise-validation.md`).

## Goals / Non-Goals

Goals: close all six items with evidence from this PR's own CI runs. Non-goals: anything touching cache keys/paths or
HEL-1299's restore/save split (driver constraint; escalate instead), any `timeout-minutes` value, product code.

## Decisions

D1 Guard over logical lines. `checkText` first folds physical lines into logical shell lines: a line ending in `\` or
in `|` (or `||`/`&&`, trailing whitespace allowed) is joined with the next; comment-only lines are dropped before
joining (a `#` line inside a continuation does not hide the rest). YAML block-scalar headers are NOT continuations: a
line whose trailing `|` is a YAML block indicator (`key: |`, `key: |-`, `- run: |`, i.e. `:\s*\|[-+]?\s*$`) is never
joined (skeptic-design-1 item 5: 20 of 30 naive joins in ci.yml were these). The block's body lines are shell and are
scanned/joined like any other line. Rules run on each logical line; a hit is reported
at the logical line's FIRST physical line number with the joined text. Alternative (regex over the whole file with
`[\s\\]*` between `ps` and `grep`) rejected: it would match across unrelated commands. Selftest adds: `ps ... \` +
`| grep`, `ps ... |` + `grep`, a three-line split, a negative (two separate lines `ps x` / `grep y`, no join), and a
YAML negative/positive pair (`run: |` header followed by a benign line is not joined; a `run: |` body containing a
split `ps ... \` / `| grep` IS flagged).

D2 Timing note. Replace the ci.yml comment's "(25-40 s)" with the shard-0 pre-step range measured on THIS PR's CI runs
(job start -> "Compile and test" start, PR and main shapes differ: PR adds the prune canary; quote the LARGER of the
PR-run and latest main-run figures), stating the job-bound margin. Comment-only edit; no step, key, path or condition changes. The archived HEL-1339 `ci-evidence.md` is a record
of what was measured then: append a dated "Correction (HEL-1362)" paragraph citing run ids, do not rewrite line 102.

D3 Capture kind. `ci_sbt_capture` returns 0 = at least one jcmd dump file written; 2 = no dump file, but SIGQUIT was
delivered to at least one verified JVM; 1 = nothing. `ci-sbt.sh` maps each to its own message (2 says "SIGQUIT sent
... dump, if any, is in sbt.log"); `e2e-backend.sh`'s `die` likewise distinguishes 2 from 1. Callers that only test
truthiness must be updated (both callers are in this repo; grep proves no others).

D3 test: both callers' rc-2 paths only fire on a hang, so the selftest exercises each deliberately with jcmd shimmed
(PATH, that spawn only) to fail: `ci-sbt.sh` (message says SIGQUIT sent, not "thread dump captured") AND
`e2e-backend.sh wait` die path (stderr distinguishes SIGQUIT-only from "no verified JVM").

D4 Hard budget. Root cause is to be confirmed by the executor with a probe before fixing (systematic-debugging law);
suspects: `timeout -k 1 <cap>` lets each call run cap+1 s, and the SIGQUIT path's `sleep 1` is unclamped. Fix shape:
every call's cap (including the kill grace) and every sleep are clamped to the remaining budget, and a candidate is
skipped (logged `skipped: capture budget exhausted`) when too little budget remains to start it. Proven by a selftest
case that calls `ci_sbt_capture` directly (bash sourcing the lib) and times ONLY that call from outside with a
sub-second clock (node `performance.now()` around a bash that records `date +%s.%N` before/after the function, never
the lib's own `SECONDS` or its "capture finished" line), with >= 3 verified backend JVMs in the recorded group AND
jcmd shimmed to hang, and a small budget (e.g. 6 s): asserts elapsed <= budget + 1.0 s and that at least one candidate
is logged as skipped. Red-first: this case and the D3 SIGQUIT-only cases are run against the UNCHANGED scripts before
the fix and their failing output recorded in files-modified.md alongside the passing output after.

D5 ci-logs: keep the diagnostics evidence, drop the unrelated logs (revised after skeptic-design-1 item 1). Of the
5.4 MB, ~5.3 MB is two full backend-job logs of FLAKY-TEST failures unrelated to sbt diagnostics
(`run37583797617-backend2-FAIL.log.txt`, OutputRoutesSpec:756; `run37586488590-attempt4-backend3-FAIL.log.txt`,
ProductEventRollupServiceSpec:85 -- ci-evidence.md:62-69); no real hang occurred (ci-evidence.md:91). The only
diagnostics evidence is the deliberate positive control (`run37583797617-security-control.log.txt` + `control-artifact/`,
136,032 B): it stays, as the durable copy of the only dump this tooling has produced (GitHub run logs expire after 90
days). The two flaky-test logs are removed from the tree (they remain in git history at d71f646cb; the correction
note names that commit and the run ids). Removal does not shrink clones (history keeps the bytes); it removes 5.3 MB
of non-evidence from checkouts and greps. The note must not call any of these files hang evidence.

D6 Remove the thin-client lever. `ci-sbt.sh --mode` option, `e2e-backend.sh`'s empty-`E2E_SBT_SERVER_FLAG` client mode,
and `_diag_socket_owner` (active.json) go. No CI call site passes `--mode` or sets the flag (grep proof in
files-modified). Rollback if `--server` ever regresses is a git revert of this diff. Mode lines keep the exact
`mode=server` token (spec "Mode is visible in the log"). `ci-sbt.sh --mode ...` now fails with usage (exit 2); selftest
case (e) (client-mode line) is replaced by a check that the lever is gone. Comments in ci.yml / e2e-backend.sh /
ci-sbt.sh that describe a selectable client mode are updated in the same change (comment-only in ci.yml).

D7 Proof on CI. Selftest (backend shard 0) exercises the real deadline path (stand-in hang JVM, real jcmd), plus new
cases: SIGQUIT-only (jcmd shimmed via PATH to fail) message, budget ceiling, removed mode. These ARE the deliberate
hang-path exercise; cite the PR run id + job log lines. No workflow_dispatch input is added.

## Risks / Trade-offs

[Guard join over-matches] -> only joins lines ending in a continuation token (YAML block headers excluded); on today's
ci.yml the remaining joins are 2 real shell continuations plus lines of one quoted jq program, none a false positive;
negative selftest cases. [jcmd shim leaks into other cases]
-> PATH override scoped to that one spawn. [Budget clamp skips a real JVM on a slow runner] -> skip is logged, group is
still stopped; budget value unchanged (25 s).

## Planner Notes

Self-approved: D5 (keep control evidence, drop two unrelated flaky-test logs), D6 (remove including the e2e lever, for consistency: the socket lookup only served it).
