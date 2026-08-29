## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review of `bug/surface-row-cap-truncation/hel-861` @ `dca807a5` (commits `b931b274`,
`61d8d07b`, `dca807a5`). Every conclusion below is derived from a command I ran, a file I read, or
a screenshot I looked at. `skeptic-final-1.md`, `evaluation-1.md` and `files-modified.md` were read
as claims to verify, not as facts.

### 0. A measurement trap I hit first — reported because it changes how the evidence reads

`start-servers.sh` is idempotent and **reused a backend that was already healthy on :9200**. That
process started `Fri Aug 28 17:26:32`; the fix commit `dca807a5` is dated `18:11`. My first
create-time check against it returned the **pre-fix** wording ("This source already holds 3303
rows…"), which looks exactly like "the reword was never applied."

It was a stale build, not a defect. I confirmed by process start time (`ps -o lstart=`), killed both
servers, restarted from the worktree, and re-verified the fresh backend (`18:16:23`) — after which
the reworded string appeared. **Every backend/UI result below was taken against the restarted,
post-`dca807a5` servers.** Flagging this because a reviewer who trusted the first reading would have
REFUTED on a phantom.

`assert-phase.sh servers` → `PASS servers` after restart.

---

### 1. PRIMARY JOB — is the round-1 navigation defect genuinely fixed?

I reproduced the **original repro end to end**, not the diff. Ground truth first: I fetched the
ticket's Sleeper URL myself — **3303 rows** all-positions, **355 rows** QB-only (my under-cap
control). I then created two real REST sources, two real pipelines, and drove the live UI at :6293.

**The correct banner still renders** (change request #3): after running the 3,303-row pipeline the
banner reads verbatim —

> ⚠ Source "HEL861-r2-BIG" truncated: this run read the first 1000 rows returned, out of 3303
> available, because of the 1000-row run cap. Results computed from this run — including any filter,
> sort, or aggregate — describe only that partial population, not the full source.

Screenshot: `hel861-r2-01-correct-banner-big.png` (dark), `hel861-r2-04-banner-light.png` (light).

**The stale-banner defect is fixed.** I probed the DOM directly after each navigation with a regex
for `Source "…" truncated:` rather than eyeballing, and screenshotted the key ones:

| Path exercised | Banner present? | Correct? |
|---|---|---|
| Run 3,303-row pipeline | **yes**, accurate | ✅ |
| → click a *different* pipeline in sidebar (`HEL-315 offers pipe`, Static, 3 rows) — **the exact round-1 repro** | no | ✅ (`hel861-r2-02-after-nav-other-pipeline.png`) |
| → browser **Back** to the truncated pipeline | no | ✅ (no stale/false banner) |
| → browser **Forward** | no | ✅ |
| Run truncated → navigate to the **under-cap (355-row) pipeline** | no | ✅ |
| **Run** the under-cap pipeline there (real run, 355 rows) | no | ✅ no false positive |
| Run truncated → navigate to a **genuinely never-run pipeline** (created fresh, `lastRunStatus: None`) | no | ✅ (`hel861-r2-03-neverrun-clean.png`) |
| **Dry run** on the truncated pipeline | **yes**, accurate, `Preview: 1000 rows` | ✅ |
| → navigate away from a **dry-run** banner | no | ✅ (this path is not covered by the new unit test, so I checked it live) |

All nine paths behave correctly. The defect is fixed, and fixed on every adjacent path I could
construct — including the dry-run variant, which the regression test does not exercise.

Light/dark parity re-checked myself (toggled the theme through the command palette, not by poking
the DOM attribute): banner renders correctly in both, `--app-warning-surface` / `--app-warning` /
`--space-*` / `--text-sm` / `--app-radius-sm`, `color-mix` border, **no hardcoded values**, good
contrast both ways, consistent with sibling warning surfaces. `role="alert"` is right for a
run-completion warning. Design-wise I have no objection.

Console: only the pre-existing `404 /api/pipelines/:id/schedule` for schedule-less pipelines. No new
errors.

### 2. Would the new regression test actually have caught the original bug? — measured, not assumed

I did not take the commit message's word for the RED. I reproduced it: checked out `dca807a5` into a
throwaway worktree outside `.claude/worktrees/` (the root jest config's `testPathIgnorePatterns`
excludes it), ran the test GREEN, then **deleted exactly the three added lines from `clearRunState`**
(programmatically, scoped to that reducer so the identical lines in `submitPipelineRun.pending` were
left intact) and re-ran.

GREEN with the fix:

```
Tests:       63 skipped, 1 passed, 64 total
```

RED with the three lines removed:

```
● clearRunState reducer (HEL-861 skeptic-final-1: stale banner-across-pipelines regression)
  › clears the truncation fields alongside every other run-scoped field

    expect(received).toBe(expected) // Object.is equality
    Expected: false
    Received: true

    > 380 |     expect(nextState.runSourceTruncated).toBe(false);
Tests:       1 failed, 63 skipped, 64 total
```

The test genuinely exercises the fixed path and genuinely fails without it. Its fixture is also
built by dispatching a real `submitPipelineRun.fulfilled` (not by hand-assembling state), and it
asserts the precondition (`runSourceTruncated === true`) before clearing — so it cannot pass
vacuously against an empty fixture. File restored, worktree verified clean, then removed and pruned.

### 3. The two round-1 non-blocking items — reworded strings still lead to correct conclusions

**(a) `rowCapNotice`.** Verified **live** on the restarted backend (`POST /api/sources`, 3,303-row
source):

> "This source held 3303 rows when its schema was inferred, more than the 1000-row run cap. Pipeline
> runs over this source will be truncated to 1000 rows."

This is now strictly honest: the first clause is a past-tense report of what was actually measured
(and `CreateSourceEnvelope.rowCapNotice` composes it purely from `schema.observedRowCount`, no
second fetch), and the second clause is the forward-looking consequence, which remains
unconditionally true for any source at or above the cap regardless of drift. A caller acting on it
reaches the correct conclusion — and a *more* correct one than before, since the old wording invited
the reader to treat 3303 as a standing fact. The reword did not overshoot into vagueness: the number
and the cap are both still stated. Under-cap control (355 rows): `rowCapNotice` key **absent
entirely**. No false positive.

**(b) MCP `run_pipeline` `Returns { … }`.** Now reads
`{ pipelineId, status, rowCount, sourceRowCount, outputDataTypeId, truncated, availableRowCount,
truncationNotice }`. I checked this against the actual return statement in `helioApi.ts:564-574`
rather than against the claim: those are **exactly** the eight keys constructed, no more and no
fewer. The list is now genuinely exhaustive, so it no longer misleads by reading as complete while
omitting fields. The surrounding warning ("rowCount is NOT guaranteed to be the source's complete row
count… read `truncationNotice` before treating a filter/sort/aggregate…") is unchanged and still
steers an agent correctly.

### 4. Core outcome — re-confirmed, not inherited

**API, live, restarted backend.** Over-cap run: `rowCount: 1000`, `sourceRowCount: 1000`,
`sourceTruncated: true`, `sourceAvailableRowCount: 3303`, `truncatedReads: [{HEL861-r2-BIG, 1000,
3303}]`, plus the full `truncationNotice`. Under-cap run: `rowCount: 355`,
`sourceTruncated: false`, `truncatedReads: []`, `truncationNotice` absent. No false positive.

**MCP surface, driven live by me** — I built `helio-mcp`, minted a real PAT, and called
`HelioApi.runPipeline` against the running backend (not a fixture):

```json
{"pipelineId":"…","status":"succeeded","rowCount":1000,"sourceRowCount":1000,
 "outputDataTypeId":"…","truncated":true,"availableRowCount":3303,
 "truncationNotice":"Source \"HEL861-r2-BIG\" truncated: this run read the first 1000 rows returned,
 out of 3303 available, because of the 1000-row run cap. …"}
```

and under-cap: `"truncated": false, "availableRowCount": 355` — an explicit `false`, so a truncated
run is distinguishable from a complete one by value, not by key absence. I also confirmed the only
`helio-mcp` change since round-1's live verification (`git diff 61d8d07b..dca807a5 -- helio-mcp/`) is
the description string — the data path is byte-identical to what was already driven live, and I
re-drove it anyway.

**Cap unchanged.** `grep -rn "MaxRunRows|maxRunRows" backend/src/main` → `MaxRunRows: Int = 1000`
defined exactly once, `private val maxRunRows = InProcessPipelineEngine.MaxRunRows`, no env var / no
config key / no setter. Both new consumers read the constant rather than embedding `1000`.

### 5. Gates — all four run by me, output read

| Gate | Result |
|---|---|
| `sbt test` | `Tests: succeeded 3702, failed 0, canceled 0` / `All tests passed` (238 suites) |
| `npm test` | MCP **213/213**, frontend **2948/2948** (2947 in round 1 + the 1 new regression test) — run from a throwaway checkout outside `.claude/worktrees/` |
| `npm run lint` | `LINT_EXIT=0` (`eslint . --max-warnings=0`) |
| `npm run typecheck` | `TC_EXIT=0` (`tsc --noEmit`) |

### 6. Acceptance criteria traced

| AC | Evidence |
|---|---|
| Over-cap run reports truncation + rows available | live API + MCP + UI, all showing `3303` |
| Under-cap run reports no truncation | live: `sourceTruncated:false`, `truncatedReads:[]`, no banner, no `rowCapNotice` — verified at all three surfaces |
| Visible via **both** MCP and UI, distinguishable from a complete run | MCP `truncated:true/false` explicit + `truncationNotice`; UI banner present/absent — both driven live |
| 3,303-row repro shape surfaces `3303` | reproduced with the ticket's own URL |
| 1000-row bound unchanged | single `MaxRunRows = 1000`, non-configurable |
| Schemas/openspec updated | 3 spec deltas present; `grep sourceRowCount schemas/` → nothing, i.e. this response shape was never schema'd (only the persisted `pipeline-run-record`), so there is no missing schema file. Re-derived, not inherited. |
| Wording leads to a correct conclusion | every emitted string read; both reworded strings verified above |

---

### Verdict: CONFIRM

The one blocking defect from round 1 is genuinely fixed — verified by reproducing the original repro
in the running app, not by reading the diff — and it holds across every adjacent navigation path I
could construct, including back/forward, never-run pipelines, and the dry-run variant the unit test
does not cover. The regression test was measured RED without the fix and GREEN with it. The correct
banner still renders. Both non-blocking rewords landed and are more accurate than what they replaced.
The core outcome, the four gates, and the untouched 1000-row cap all re-confirm. This ships.

### Non-blocking notes

- **Pre-existing, unrelated stale-state leak, worth a spinoff.** The footer chip
  `Snapshot replaced: N rows` does **not** clear on pipeline navigation: after a 1,000-row run,
  navigating to a 3-row pipeline still shows "Snapshot replaced: 1000 rows" next to
  "Rows written: 3". I confirmed this is **independent of truncation** — it reproduces identically
  after an *untruncated* 355-row run (chip reads "355" on the 3-row pipeline), so it is not this
  ticket's failure mode. Root cause is a different state source: `PipelineDetailFooter.tsx:165-169`
  renders from `sseData.status`/`sseData.rowCount`, which live in the SSE hook, **not** in the Redux
  run-scoped fields `clearRunState` owns. `git diff main...HEAD --name-only -- frontend/` confirms
  this change touches neither the footer nor the SSE hook. Out of scope here; genuinely misleading in
  its own right and a good candidate for a follow-up alongside HEL-873.
- HEL-873 (banner absent after page reload, because persisted run history carries no truncation
  signal) re-observed and confirmed to be the known/accepted out-of-scope item — distinct from the
  navigation defect, which is fixed.
- `truncationFields` still dedupes by `dataSourceName`; two distinct sources sharing a name would
  collapse. Unchanged from round 1, still vanishingly unlikely, noted only to keep it on record.

### Housekeeping

All dev data I created in the shared Postgres was deleted and **verified gone by re-listing**
(3 pipelines, 3 REST sources, 6 data types, 1 PAT — every endpoint now returns `[]` for `HEL861-r2`).
Servers were restarted (deliberately, see §0) and left running. The throwaway jest worktree was
removed and pruned. My four screenshots were moved out of the repo root into the session scratchpad;
the pre-existing `hel861-truncation-banner-light.png` at the repo root was left where I found it, as
round 1 did.
