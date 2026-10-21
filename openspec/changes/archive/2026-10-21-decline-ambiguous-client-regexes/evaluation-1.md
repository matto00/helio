## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `e872cf975c2cacad65bfd736404f275167a664af` (base resolved live: `4f729eed7dd52150f056b6f5a20eac856cb794a7`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (catastrophic pattern never blocks the main thread > ~100 ms, red-first e2e long-task probe): met.
  `e2e/hel1683-regex-main-thread.spec.ts` re-run by me, green (control 0.0 ms, probe 0.0 ms, overrun 0.0 ms;
  probe went to `POST .../draft-preview`; overrun showed the server's "exceeded the 2 s regex time budget" step error).
  Red corroborated independently (not only from the executor's evidence file): the base-commit `javaRegex.ts`
  accepts `^(.*.*.*.*.*.*.*.*x)` and runs it at 575 ms over the probe's 5 cells in Node 22 / V8, so the
  unmodified tree produces a long task far above 100 ms, and the spec's failure message reports the measured duration (C1).
- AC2 (normal regexes identical, parity corpus green): `pipelineStepParity.test.ts` (in the full Jest run) and
  `PipelineStepParitySpec` (709 tests, 0 failed, run by me) both green; the 7 new `regex declines:` vectors pass in Scala;
  the corpus diff is additions only (zero `-` lines).
- Design D2 matched item by item in `javaRegexCost.ts`:
  - fenced = quantified atom whose next item is an atom with `min >= 1` and a disjoint set (`isFenced`, lines 47-57);
  - **branch end counts as UNFENCED**: `next !== undefined` is required for a fence (line 53). The executor's mutation
    named "end of branch/pattern counting as fenced" is the *mutation* (flipping that to a fence), not the shipped
    behaviour; the shipped code matches design. Pinned by `(b{29}a?|z)c` declined vs `(b{29}a?c|z)c` accepted
    (`javaRegex.test.ts`, "treats the last item of an alternation branch as unfenced");
  - Rule W: `wides.length >= 2 && (hasAlternation || any non-last unfenced)` (line 115);
  - Rule N whole cap only when `P > 1` (line 118), tail cap `P x max(1, tail) <= 4` for unfenced wides (line 119);
  - wide = unbounded or `max-min+1 > 16`; `$` weight 2, `^` 0, wide atom weight 1, others `max`; lazy = greedy.
- Spec scenarios (`specs/pipeline-client-evaluator/spec.md`) each have a matching Jest case or e2e step.
- Tasks: all ticked and match the diff. Minor wording mismatch noted under Suggestions (3.2 says `sbt testFull`).
- Scope: frontend evaluator + its test, corpus additions, one e2e spec; no backend/API/schema change; `usePipelineDraftFrames.ts` untouched.
- Constraint C1 honoured: red is an assertion failure reporting the measured duration (825 ms), not a timeout.

### Phase 2: Code Review — PASS
Gates run fresh by me in `WORKTREE_PATH` (load < 2 throughout):
- `npm run lint` — clean (zero warnings).
- `npm run format:check` — all files formatted.
- `npm run typecheck` — clean.
- `HELIO_JEST_MAX_WORKERS=2 npm test` — root 61 suites / 524 tests, frontend 749 suites / 9339 tests, all passed.
- `npm --prefix frontend run build` — succeeded.
- Backend: no `backend/**` change, so `sbt testFull` is not a triggered gate; I ran
  `sbt "testOnly com.helio.domain.engine.PipelineStepParitySpec"` under the sbtfull lock because the shared corpus changed:
  709 succeeded, 0 failed, all 7 new vectors listed.
- e2e: `npx playwright test e2e/hel1683-regex-main-thread.spec.ts --workers=1 --trace retain-on-failure` with
  `DEV_PORT=7115 BACKEND_PORT=10022` under the e2e lock: 1 passed.

Independent soundness probe (scratch copy, not in the repo): fuzzed 20,000 random patterns over atoms
`a b \d \w . [ab] x \s -`, quantifiers `* + ? {0,3} {2} {1,20} *?`, nested groups and alternation; 6,343 were accepted;
the slowest accepted pattern on 200-char adversarial cells cost about the same as the `a*b` baseline (~0.02-0.03 ms per cell). No
super-linear accepted pattern was found.

Code-quality notes:
- Structure is modular: tree building in `javaRegex.ts`, the rule in `javaRegexCost.ts` (119 lines), sets in
  `javaRegexSets.ts` (91 lines). Constants are named with a reason (`WIDE_EXTENTS`, `MAX_COST`, `MAX_TAIL_COST`, `DOLLAR_WEIGHT`).
- `javaRegex.ts` is 300 lines (was 214), above CONTRIBUTING.md's ~250 soft budget but well below the ~400
  "propose a split" line. The growth is mostly Prettier-expanded return objects in `readClassEnd`, and the logic was already
  split into two new modules. Judged acceptable (non-blocking).
- Type escapes: `simpleEscapeSet(e)!` (javaRegex.ts) is guarded by `SIMPLE_ESCAPES.has(e)`; the `as AtomItem` cast in the
  quantifier branch is guarded by the `last === "atom"` invariant. Both are justified by local invariants.
- The mutation table (`evidence/mutations.md`) covers every guard; I spot-checked the reasoning for the branch-end, cost-cap and
  `$` cases against the test arithmetic and it is consistent.
- No dead code, no TODO/FIXME, no new dependency.

### Phase 3: UI Review — PASS
Triggered by `frontend/**`. Servers were started and stopped only with `start-servers.sh` / `stop-servers.sh` (7115/10022).
- Happy path: the e2e control `(\d+)` is client-evaluated (no draft-preview request, 5 rows). In a manual pass, `([a-z]+)!`
  rendered client rows with the step live.
- Declined path: manual `^(.*.*.*.*.*.*.*.*x)` showed "Preview is updating", then "Preview is live" with the server's 5 rows
  (`out` null), which is correct for a pattern without `x`.
- Error path: manual `^(a*a*a*a*a*a*a*a*a*a*)$` showed the server's "exceeded the 2 s regex time budget" step error.
- Console: one pre-existing `404` for `GET /api/pipelines/:id/schedule` on page load (the pipeline has no schedule, which is
  unrelated to this change). No errors during the regex edits.
- Accessibility and breakpoints: no component, style or markup change in the diff (evaluator logic only), so there is no
  layout surface to break.
- Test data: the manual pass's pipeline `c258e89b-e8f6-42f0-b31b-742831fe807a` and source
  `ca4a4b8e-8597-4002-9718-19d1713bc395` were deleted via API (204/204). User `165a4503-3822-4031-826d-009a8f02a3dd` was
  deleted by exact id+email through the repo's `buildUserDeleteSql`. The e2e run's own user was removed by its global teardown.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `tasks.md` 3.2 says the Scala side was verified "via `sbt testFull` under the lock", but the executor ran only
  `PipelineStepParitySpec` via `testOnly`, and so did I. Because no backend source changed, that spec is the only Scala
  consumer of the corpus (`ParityCorpus.scala` / `PipelineStepParitySpec.scala`). Reword the task, or let CI's
  `testFull` stand as the full run.
- `javaRegexSets.ts:simpleEscapeSet` and `javaRegex.ts:SIMPLE_ESCAPES` each list the same eight escape letters. If the
  `SIMPLE_ESCAPES` membership test were derived from `simpleEscapeSet(e) !== undefined`, there would be one list and the
  `!` assertions could go.
- Design D4 asks for a boundary test on a "`.`-atom run tail". The tail boundary pair is `(.*)\.csv` / `(.*)\.json`,
  which is an escaped literal dot. The decline `.*.{60}z` exercises a `.`-run tail, but not at the 4/5 boundary.
  `.*.{4}` accepted vs `.*.{5}` declined would pin it literally.
- `javaRegex.ts` is 300 lines. If it grows again, move the `readClassEnd`/`parseClass` class parser into its own module.
- A stray `.playwright-mcp/` directory exists at the main checkout root (`/home/matt/Development/helio/.playwright-mcp`),
  where the MCP browser writes its snapshots. Git status there is clean, so it is untracked or ignored. I did not delete it
  because it is outside this worktree.
