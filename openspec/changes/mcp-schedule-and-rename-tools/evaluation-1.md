## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `0e32bd79` on `feature/mcp-schedule-and-rename-tools/hel-863`.
All gate results below are from my OWN fresh runs, not the executor's pasted output.

### Phase 1: Spec Review — PASS

Acceptance criteria, each checked against code + the live probe transcript
(`.concertino/runs/HEL-863/evidence/ampersand-probe-transcript.txt`):

- **AC1 (set/read/delete a schedule entirely over MCP)** — PASS. All three tools registered
  (`get_pipeline_schedule`, `set_pipeline_schedule`, `delete_pipeline_schedule`) and exercised
  end-to-end through the real stdio transport against a live backend, including both 404 arms.
- **AC2 (no divergent second source of truth)** — PASS. I independently verified the UI side:
  `frontend/src/features/pipelines/services/pipelineService.ts:272/282/290` calls exactly
  `GET`/`PUT`/`DELETE /api/pipelines/:id/schedule` — the identical routes `helioApi.ts` now calls.
  The MCP layer holds no cache or store of its own. The evidence is architectural rather than a
  literal UI screenshot, which task 9.1 explicitly permits ("a request-level trace plus the UI read").
- **AC3 (rename preserves id and links)** — PASS. Transcript: `id-preserved: true` after renaming to
  `"Marketing & Ops & Finance"`.
- **AC4 (`&` does not acquire HTML entities)** — PASS, and task 8's evidence genuinely closes it.
  The probe traverses the segment that actually mattered: registered tool handler → `guarded()`
  JSON serialization → real `@modelcontextprotocol/sdk` `Client`/`StdioClientTransport` JSON-RPC →
  real HTTP → real backend. It covers the CREATE path (`create_dashboard`, and the field report's
  actual `apply_proposal` scenario with `dashboardName: "Q3 Revenue & Growth"`) as well as rename,
  and asserts on the transport-delivered string plus a raw-byte hex dump
  (`53616c6573202620526576656e7565` — byte `0x26`, a literal `&`). The conclusion is correctly
  scoped in `files-modified.md` to "the only unreachable segment is the calling agent's own client",
  which is exactly what task 8.3 demanded, and the design's enumeration is NOT cited as the closer.
  This is real measurement, not attestation.
- **AC5 (no backend/frontend/migration changes)** — PASS, verified by enumerating the diff's file
  list, not by trusting the claim: `git diff main...HEAD --stat` touches only `helio-mcp/src/**`
  (6 files) and this change's own `openspec/changes/**` artifacts. Zero files under `backend/`,
  `frontend/`, or `db/migration/`.

Other Phase-1 checks: all task items marked done match what was implemented; no scope creep (the
dashboard-`appearance` gap was correctly recorded for a spinoff rather than absorbed); spec deltas
in `specs/mcp-pipeline-schedule-tools/` and `specs/mcp-edit-in-place-tools/` describe the behaviour
that actually shipped; no API contract change was needed (no schema/OpenAPI file touched, correctly).

### Phase 2: Code Review — FAIL

**Gates (all re-run by me in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set):**

- Dependency trees confirmed present on disk BEFORE reading any exit code: both
  `node_modules` and `helio-mcp/node_modules` exist. `git status --porcelain` is empty (no stray
  uncommitted state inflating the result).
- Collection proof first (`--listTests`): non-empty, **14 files enumerated by name**, including the
  new `helio-mcp/src/tools/scheduleTools.test.ts`. I verified `httpClient.test.ts` is tracked on
  `main` (`git ls-tree main`), so 13 baseline + 1 new = 14 reconciles exactly.
- `npx jest helio-mcp --testPathIgnorePatterns "/node_modules/" "/openspec/" "/frontend/" "/e2e/" "/helio-mcp/dist/"`
  → **14 suites / 245 tests passed**, 0 failed. Matches the executor's claim.
- `npx tsc --noEmit` in `helio-mcp/` → exit 0, no output (trustworthy: `helio-mcp/node_modules`
  confirmed present).
- `npm run lint` (`eslint . --max-warnings=0`) → clean. `npm run format:check` → clean.
- `npm --prefix frontend run build` / `sbt test` not run: no file under `frontend/**` or
  `backend/**` changed.

**Backend-truth audit of the four tool descriptions (standing requirement 4).** I read
`backend/src/main/scala/com/helio/services/pipelines/PipelineScheduleService.scala` in full and
checked every factual claim in `scheduleTools.ts`:

- `kind` ∈ {`cron`, `interval`} — matches `ScheduleKind.fromString`. Correct.
- Cron: 5 space-separated fields in order `minute hour day-of-month month day-of-week`, tokens
  `*` / bare number / `lo-hi` / `base/step`, comma-separable — matches `cronFieldBounds`
  (`0-59, 0-23, 1-31, 1-12, 0-6`) and `isValidCronField` token-by-token. Correct.
- Interval `<n><unit>`, unit ∈ s/m/h/d, n > 0 — matches `intervalPattern` + the `_ > 0` guard. Correct.
- `timezone` required, IANA zone id, no client default — matches `validateTimezone`/`ZoneId.of` and
  the required `String` in `PutPipelineScheduleRequest`. Correct, and D3's rationale holds.
- `enabled` omitted ⇒ enabled — matches `req.enabled.getOrElse(true)`. Correct.
- `nextRunAt` asymmetry — matches `cadenceChanged` (kind / trimmed expression / timezone) with
  `else existingOpt.flatMap(_.nextRunAt)`. Correct, including the "toggling `enabled` alone
  preserves it" half.
- `get`: absent schedule ⇒ 404 not empty — matches `NotFound("Pipeline schedule not found")`. Correct.
- `delete`: absent schedule ⇒ 404 not no-op — matches the `case false` arm. Correct.
- Upsert keeps the schedule id — matches `existingOpt.map(_.id)`. Correct.
- "does not re-validate client-side" — true; no grammar duplication exists in the diff. The
  descriptions advertise no validation the tools do not perform.
- `update_dashboard` advertises nothing it does not accept: the `inputSchema` is exactly
  `{ dashboardId, name }` and `HelioApi.updateDashboard` sends exactly `{ name }`. Correct.

**Other code checks:** tool-name collision checked by enumeration, not by counting — 62 unique
`registerTool` names across `helio-mcp/src/tools/*.ts`, 62 total, zero duplicates, all four new
names present. Wire types mirror the Scala `jsonFormat10`/`jsonFormat4` field-for-field. D5's
omit-vs-explicit `enabled` encoding is implemented as specified. Error handling is correct at the
boundary: handlers propagate `HelioApiError` rather than converting it, and `guarded()` renders it
with `isError: true` (confirmed live in the transcript). No dead code, no `any` escape hatches, no
leftover TODOs. The `scheduleTools.ts` extraction is a genuine, justified decomposition, not
over-engineering — D10's OOM rationale is real and documented.

**Issues (both found by auditing prose/assertions against measured behaviour):**

1. **A factually false doc comment** — `helio-mcp/src/helioApi.ts`, `deletePipelineSchedule`'s
   comment claims `guarded()`'s `JSON.stringify(value, null, 2)` "yields the string `"undefined"`"
   for a `void` return. Measured: `JSON.stringify(undefined, null, 2)` returns the **value**
   `undefined` (`typeof` → `"undefined"`, not `"string"`). `design.md` D11 states this correctly
   ("yields `undefined` (not a string)"); the code comment inverts it. The engineering conclusion
   (synthesise a payload) is right either way, but on an epic whose standing requirement 2 is
   "audit prose against code, including your own", a comment that asserts a measurably false fact
   is a defect.

2. **A weak assertion whose test name over-claims** — `helio-mcp/src/tools/scheduleTools.test.ts`,
   the test named *"update_dashboard does not advertise appearance or layout as accepted fields"*.
   Its two negative regexes are `/accepts?\s+appearance/i` and `/accepts?\s+layout/i`. Measured:
   both are **incapable of matching the backticked style the description itself uses** —
   `"Accepts \`appearance\` too"` does not match (the backtick blocks `\s+appearance`), while only
   the unbackticked `"Accepts appearance too"` matches. So a future description that advertised
   `` `appearance` `` in this file's own prose style would sail past this guard. The only load-bearing
   assertion left is `toContain("does not accept")`, which is satisfied even by a description that
   ALSO says it accepts `appearance`. Task 6.3 exists specifically to guard against field-report
   issue #7 (a tool advertising a field it does not accept); as written it cannot discriminate that
   failure for `appearance`. Standing requirement 3: a weak assertion is the same as no test.

**Not defects, recorded so they are not re-litigated:**

- The probe's `nextRunAt preserved: true` and the "should RESET" section are vacuous — `nextRunAt`
  was absent throughout the run (HEL-415's scheduler runtime was never started, so nothing computes
  it). This is *correctly and explicitly scoped* in `files-modified.md`, which states the semantics
  are covered by the description test and by reading `PipelineScheduleService.put` instead. I
  independently confirmed the asymmetry in the service source. Honest scoping, not an overclaim.
- `write.ts` (1241 lines) and `helioApi.ts` (1083 lines) both exceed CONTRIBUTING's ~400-line
  "propose a split" threshold, but both were already far over it before this change, and the
  D10 extraction is the proactive decomposition the standard asks for. Non-blocking (see below).

### Phase 3: UI Review — N/A

No trigger matched: the diff touches no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, and no
`openspec/specs/**` (the added spec files are under `openspec/changes/**`, which is not a trigger).

### Overall: FAIL

Both change requests are small and localized; nothing about the design, the tool contracts, or the
probe evidence needs rework.

### Change Requests

1. `helio-mcp/src/helioApi.ts` — in `deletePipelineSchedule`'s doc comment, replace the claim that
   `JSON.stringify(value, null, 2)` "yields the string `"undefined"`" with what it actually yields:
   the value `undefined` (i.e. not a string at all), which is why a synthesised payload is required.
   Match `design.md` D11's already-correct wording. No behaviour change.

2. `helio-mcp/src/tools/scheduleTools.test.ts` — in the test *"update_dashboard does not advertise
   appearance or layout as accepted fields"*, replace the two unbacktick-blind regexes
   (`/accepts?\s+appearance/i`, `/accepts?\s+layout/i`) with assertions that can actually
   discriminate the failure the test names, tolerating backticks/quotes — e.g.
   `expect(UPDATE_DASHBOARD_DESCRIPTION).not.toMatch(/accepts?\s+[`'"]?appearance/i)` and the
   `layout` equivalent. Then prove the guard by behavioural mutation: temporarily change the
   description to `` "Accepts `appearance` too." `` and confirm the test goes red before reverting
   (a green-only check does not distinguish a working guard from a dead one — which is precisely
   how the current version passes).

### Non-blocking Suggestions

- `GET_PIPELINE_SCHEDULE_DESCRIPTION` says it "Returns the full schedule record:" and then lists 8
  of the 10 fields, omitting `id` and `pipelineId`. Harmless today, but "full record" followed by a
  partial enumeration invites an agent to conclude those two fields are absent. Either drop the word
  "full" or list all ten.
- When opening the PR, note that `write.ts` (1241 lines) and `helioApi.ts` (1083 lines) remain well
  past CONTRIBUTING's ~400-line split threshold, as that standard asks. Not this ticket's job to
  fix, but the note is what the standard actually requires of an author adding to such a file.
