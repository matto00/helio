## Skeptic Report — final gate (round 2, skeptic-final-2.md)

**Commit reviewed:** `2a43e5433f98625981aa7e048cdfc0c6c446b0ee`. The base was resolved live with `resolve-review-base.sh` as `d125b654141ac79d96a8fd0f9cb5e74b834c7c0c`. Three commits: 482b1d794, b871f80fe and 2a43e5433.

**Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/baseline-semantics-after-thinning/HEL-1285`.

**Working tree:** one uncommitted edit, `tasks.md`, which rewords the C5 bullet to "After the Phase-3 archive …". It is not code. The orchestrator should commit or drop it before squash.

### What I verified (with evidence)

**Round-1 CR1: both schemas are rewritten.**
- `schemas/outputs/output-history-response.schema.json:35` and `public-output-history-response.schema.json:32` now say:
  - `previous_run` is "the immediately previous recorded run (history thinning never deletes an Output's newest 101 points)".
  - A window baseline is the newest surviving point, which "may be up to one thinning bucket (5 minutes, 1 hour or 1 day by age) earlier".
- Both files parse as JSON.
- `npm run check:schemas` exited 0: "schemas in sync with JsonProtocols (122 checked …)".

**Round-1 CR2: `mcp-output-tools` MODIFIED delta.**
- The header `### Requirement: get_output_history MCP tool` matches main exactly (grep count 1).
- The delta replaces only the description paragraph. All five scenarios are preserved verbatim, including "does not contain the phrase 'previous run'".
- The shipped description (`helio-mcp/src/tools/outputs.ts:246-250`) says "immediately previous recorded run". That does not contain "previous run", and `server.test.ts` pins this: 15/15 passed, run by me.
- The neighbouring "compare is documented on every Output config write tool" requirement in main does not pin the old wording (lines 184-195 read), so it needs no delta.

**Round-1 CR3: `output-snapshot-history` MODIFIED delta.**
- The header `### Requirement: History repository primitives` matches main.
- The requirement text gains the 101-protection and age-cap qualifiers.
- The "Thinning keeps the newest point per bucket" scenario is now scoped to points older than the newest 101.
- The other four scenarios are byte-identical to main (compared side by side).

**C5 note from the orchestrator: is the remaining pre-archive wording replaced by a delta?**
- I diffed the `output-history-api` delta against main `openspec/specs/output-history-api/spec.md:48-107` ("Comparison resolution"). The only differences are:
  - The `previous_run`/window paragraph: main lines 55-57, which carry the old "second-newest retained … not necessarily the immediately previous run" text.
  - One added scenario: "previous_run after thinning is the literal previous run".
- Every other line and scenario is identical.
- So both pre-archive hits, `output-history-api/spec.md:55-56` and `mcp-output-tools/spec.md:151`, are replaced by MODIFIED deltas on archive.
- `openspec validate baseline-semantics-after-thinning --strict`: "Change … is valid".
- `npm run check:openspec` and `check:spec-structure` both exited 0.

**Other main specs.**
- I grepped `openspec/specs` for `previous_run|previous point|previous run|thinn`.
- The `chart-history-overlay` "no Previous option" text is replaced by its MODIFIED delta. I read both the delta and main; the scenarios are preserved and a "Choosing Previous" scenario is added.
- `output-history-retention` lines 19-20 are covered by its delta.
- `metric-history-delta-ui` and `output-routes-api` state nothing contradicted.

**AC1 (decision recorded on HEL-918): verified.**
- I read Linear comment `61b8179c-…` via the GraphQL API: issue HEL-918, created 2026-10-07T21:20Z.
- It records exactly Q1 protect-newest-101 (literal previous / n most recent, age cap wins, fixed constant), Q2 D6 plus the bucket slack, Q3 re-adding chart Previous, and Q4 docs only.
- It matches `escalation.answered` in `events.jsonl`.

**AC2 (code matches decision; thinned-fixture test of both baselines): verified, re-run by me.**
- Code read in the diff:
  - `OutputHistoryRepository.thinAndPurge` ranks recency per output with `captured_at DESC, id DESC` and buckets only `recency > $protectedNewest` (a bound value). The age-purge DELETEs are untouched and run first.
  - `HistoryBaselineLimits.MaxRollingN = 100`, `ProtectedNewestPoints = MaxRollingN + 1`, and `HistoryBaseline.MaxRollingN` aliases it. There is no env var.
  - Window compare code is unchanged; only scaladoc was added (C2).
- Test run: `nice -n 19 sbt -batch -Dsbt.server.autostart=false "testOnly …HistoryBaselineAfterThinningSpec …OutputHistoryRoutesSpec …OutputHistoryRepositorySpec …OutputHistoryRetentionServiceSpec"`.
  - The `loading project definition from` line points to this worktree's `backend/project`.
  - Result: `Tests: succeeded 61, failed 0`, exit 0.
  - (a), (b), (c1), (c2), the age-cap case and the 40-day free+owner case are all listed as passed.
  - So are the repository small-K and age-cap cases, and the renamed `OutputHistoryRoutesSpec` "use the second-newest point (not the newest)", which is the only backend change in 2a43e5433 (a title-only change).
- Red proof: I did not re-run it. I rely on two independent sources:
  - The evaluator's own reproduction in a throwaway worktree (evaluation-2.md: (b) `Some(11:59) was not equal to Some(12:03)`, (c1) `995.0 was not equal to 999.0`, (c2) `None.get`).
  - The executor's persisted log.
  - Nothing in the SQL or the spec changed after b871f80fe, which is what they reviewed: 2a43e5433 touches no `backend/src/main` file and changes one test title.

**AC3 (document wherever users see the baselines): verified.** The schemas (both), CLAUDE.md, `api/routes/alerts/README.md`, the helio-mcp `COMPARE_CONFIG_DOC` and the `get_output_history` description, and the specs all state:
- Literal previous / n-most-recent.
- The tier age cap still wins (README and specs).
- The window bucket slack.

**Frontend.**
- Jest `OutputEditorSheet.compare|metricHistoryView|compareOptions|chartOverlay`: 114/114 passed.
- `npm run format:check` exited 0.
- The evaluator's cycle-2 lint, build and full jest runs apply unchanged, because 2a43e5433 touches no frontend file.

**UI judgment.**
- The only visual change is that the chart Output Compare `Select` now lists "Previous".
- `CHART_COMPARE_OPTIONS` is literally `METRIC_COMPARE_OPTIONS`, so the chart picker is identical, by construction, to the existing metric sibling's option list in the same shared `Select` component.
- There are no new styles, tokens or components.
- The overlay legend for a stored `previous_run` reads "vs previous" through the existing `compareLabel`.
- The evaluator's e2e ran in light and dark: 2 passed, "Previous" exactly once.
- I took no screenshots of my own. The brief forbids the shared Playwright MCP browser, and the change has no styling surface to judge. This is disclosed, not hidden.

### C5 literal-grep finding (not a ship blocker; the orchestrator must reconcile)

I simulated the post-archive state by dropping the three hits that the deltas replace. The second C5 entry's literal command (`grep -rniE 'RETAINED point|…'`, case-insensitive) still returns **6 hits**:
- `openspec/specs/output-history-scrubber/spec.md:9` ("lists that Output's retained points newest first").
- `openspec/specs/output-history-scrubber/spec.md:46` ("Comparison point is the next-older retained point").
- `frontend/src/features/pipelines/ui/outputHistory/HistoryScrubber.tsx:35`.
- `useOutputHistoryView.ts:28`.
- `OutputHistoryModal.tsx:18`.
- `OutputHistoryModal.tsx:20`.

The same 6 hits exist on base `d125b6541` (`git grep` count 6). The case-sensitive form returns 0.

None of these states the old `previous_run` meaning. They describe the HEL-1277 History scrubber, which really does walk and compare adjacent *retained* points. That is accurate and unaffected by this ruling. So C5's governing clause ("No surface … states the old previous_run meaning") and the tasks.md C5 wording ("the superseded previous_run wording") are met.

However, two things are wrong:
- tasks.md 6.3 is checked `[x]` with the claim "(case-insensitive): zero hits". That is false as written, and it is a completion claim without matching evidence.
- The duplicate C5 entries in workflow-state.md disagree.

**Do not reword the correct scrubber text to satisfy the grep.** That would be grep-chasing, not a fix. Instead, the orchestrator should:
1. Retire one of the two C5 entries.
2. Restate the grep as case-sensitive, or scope it to `previous_run`.
3. Have 6.3 record the 6 scrubber hits as out of scope, with the reason above.

### Verdict: CONFIRM

### Non-blocking notes
- Schema and MCP descriptions say `previous_run` is "the immediately previous recorded run" without the age-cap caveat. For example, a free-tier Output whose prior run is more than 30 days old gets a null baseline. The README and specs carry the caveat; consider adding "(within the tier's maximum age)" in a follow-up.
- The MCP `get_output_history` description says "a 1d/7d/30d window baseline". `custom:` windows behave the same way but are not named.
- `CHART_COMPARE_OPTIONS` is a bare alias of `METRIC_COMPARE_OPTIONS`; collapsing them is optional.
- Commit the uncommitted `tasks.md` C5 edit, or discard it, before squash.
- Environment: the sbt 2 thin client can attach to another worktree's server. I used `-batch -Dsbt.server.autostart=false` and confirmed the project-definition path. Worth a MISTAKES.md entry.
