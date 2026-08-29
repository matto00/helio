## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review at `4a0d4f4c`. Every result below is from my own run against ground truth
(source files, the actual diff, the probe transcript). The executor's and evaluator's
reports were read as claims only.

### What I verified (with evidence)

**Gates — re-run by me, collection proved non-empty first.**
- `npx jest helio-mcp --testPathIgnorePatterns … --listTests` → **14 files enumerated by name**,
  including `helio-mcp/src/tools/scheduleTools.test.ts`. Non-empty collection established
  BEFORE any green line was trusted (HEL-880 hazard).
- Same command without `--listTests` → **14 suites / 246 tests passed, 0 failed**.
  (Evaluator reported 245 at `d7e12a6f`; +1 is exactly the drift-guard test added by `4a0d4f4c`.
  The count reconciles.)
- `helio-mcp/node_modules` and worktree-root `node_modules` both confirmed present on disk
  before reading any exit code. `npx tsc --noEmit` in `helio-mcp/` → **exit 0**, no output.

**AC5 — no backend/frontend/migration changes.** Derived by enumerating `git diff main...HEAD --stat`:
20 files, 6 under `helio-mcp/src/`, 14 under `openspec/changes/mcp-schedule-and-rename-tools/`.
Zero files matching `^backend/`, `^frontend/`, or `migration`. **Met.**

**AC1 / AC3 — set, read back, delete a schedule; rename a dashboard preserving its id.**
Closed by the live stdio probe transcript, which I read in full: 404 before any schedule set,
successful cron PUT with `enabled` omitted normalising to `true` server-side, GET returning the
same schedule id, a second PUT keeping the same id (real upsert), `{deleted:true,pipelineId}`,
then a second delete correctly returning `isError=true` 404 rather than a silent success.
Rename shows `id-preserved: true`. **Met.**

**AC4 — `&` must not acquire HTML entities.** The probe evidence genuinely closes this, and is
stronger than an eyeball check: it asserts across all three write paths (`create_dashboard`,
`update_dashboard`, and the field report's exact `apply_proposal` scenario) and pins the create
case at the byte level — `raw-bytes: 53616c6573202620526576656e7565`, where `26` is a literal `&`
and no `&amp;` (`26616d703b`) appears. **Met.**

**AC2 — no divergent second source of truth.** Verified structurally rather than by assertion:
`frontend/src/features/pipelines/services/pipelineService.ts:272/282/290` calls
`GET`/`PUT`/`DELETE /api/pipelines/${pipelineId}/schedule` — byte-identical route shapes to the
new `helioApi.ts` methods. Both surfaces hit `PipelineScheduleRoutes` → `PipelineScheduleService`
→ one table. The MCP layer stores nothing of its own. **Met.**

**Standing requirement 4 — every factual claim in the four tool descriptions, checked against
`PipelineScheduleService.scala` / `PipelineScheduleProtocol.scala`, not against the plan:**

| Claim in description | Backend ground truth | Verdict |
|---|---|---|
| cron = 5 fields `minute hour day-of-month month day-of-week` | `cronFieldBounds` `Vector(0->59, 0->23, 1->31, 1->12, 0->6)`, `fields.length != 5` | true |
| tokens `*` / number / `lo-hi` / `base/step`, **comma-separable** | `isValidCronField`: `field.split(",").forall(isValidToken)` | true — and the comma clause is a real capability the ticket's own ground-truth summary omitted |
| interval `<n><unit>`, unit s/m/h/d, n > 0 | `"^(\\d+)(s\|m\|h\|d)$"` + `_ > 0` | true |
| `timezone` required IANA zone id, no default | `PutPipelineScheduleRequest.timezone: String` (not `Option`), `ZoneId.of` | true |
| `enabled` optional, defaults true | `req.enabled.getOrElse(true)` | true |
| GET on absent schedule = 404, not empty success | `Left(ServiceError.NotFound("Pipeline schedule not found"))` | true |
| DELETE of absent schedule = 404, not a no-op | `case false => Left(NotFound(...))` | true |
| PUT is an upsert keeping the same id | `existingOpt.map(_.id).getOrElse(new)` | true |
| cadence change RESETS nextRunAt; `enabled`-only toggle PRESERVES it | `cadenceChanged` on kind/expression/timezone → `nextRunAt = None` else preserved | true |
| 10-field response enumeration | `jsonFormat10`; fields enumerated from the case class: id, pipelineId, kind, expression, enabled, timezone, nextRunAt, lastRunAt, createdAt, updatedAt | exact set match, all 10 named |
| `update_dashboard` accepts name only, id survives | `UpdateDashboardRequest.name: Option[String]`; registration's `inputSchema` is `{dashboardId, name}` only | true — advertises nothing it does not accept |

No false claim found in any of the four descriptions. The `4a0d4f4c` field-enumeration fix is
correct and complete against the Scala source.

**Standing requirement 3 — each test name vs. what its assertions can discriminate.** Audited all
15 tests in `scheduleTools.test.ts` and the 5 added in `helioApi.test.ts`. All discriminate what
they name — the `enabled`-omitted tests assert `"enabled" in body === false` (not truthiness), the
error tests assert `rejects.toMatchObject({status, message})` (proving no swallow-to-success), and
`updateDashboard` asserts `Object.keys(body)).toEqual(["name"])`, which would catch an extra field.
**One exception**, below.

### Verdict: REFUTE

One defect, in `4a0d4f4c` — the least-reviewed commit, and exactly the class this run has already
refuted once (cycle 1's CR1 was a false doc comment; CR2 was a guard whose name overclaimed).
Everything else ships.

### Change Requests

1. **`helio-mcp/src/tools/scheduleTools.test.ts` — the drift-guard's name and comment claim a
   protection its assertions cannot deliver.**

   The test is named *"get_pipeline_schedule's field enumeration names every field
   PipelineScheduleResponse actually carries"* and its comment asserts: *"If a future field is
   added/renamed there without updating the description, this test catches the drift instead of a
   reader trusting a stale 'full record' claim."*

   Measured, not argued: the expected set is a frozen TypeScript array literal, and `grep` for
   `scala|readFileSync|backend/` in that test file returns **zero matches** — nothing in the test
   reads the Scala type. Therefore:
   - **Field ADDED in Scala** (an 11th field): description never mentions it; all 10 hardcoded
     `toContain` assertions still pass → **GREEN**. Claim false.
   - **Field RENAMED in Scala** (`lastRunAt` → `previousRunAt`): the stale description still
     contains `"lastRunAt"`, so does the stale test literal → **GREEN**. Claim false.

   What the guard actually catches is one direction only: a field being deleted from the
   *description* string — i.e. the TS-side regression this commit just fixed. That is worth having,
   but it is not what the name and comment say, and the "added/renamed" sentence is affirmatively
   false for both cases it names.

   Note for whoever fixes this: **pinning the field COUNT alongside the names does not close the
   gap** — a count literal lives on the same TS side of the boundary and is equally blind to an
   eleventh Scala field. There are only two honest resolutions, both small; pick either:
   - (a) Make the guard real: have the test read
     `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineScheduleProtocol.scala`,
     extract the `PipelineScheduleResponse` case-class field names, and assert the description
     names exactly that derived set. Same repo, one `readFileSync` + one regex; this makes the
     existing name true.
   - (b) Keep the frozen literal but tell the truth: rename to something like *"…names every field
     in the pinned PipelineScheduleResponse field list"* and replace the "added/renamed" sentence
     with an explicit statement that the list is a hand-maintained snapshot which cannot detect a
     field added or renamed on the Scala side.

   Option (b) is a two-line edit and fully acceptable. What is not acceptable is shipping a test
   whose name and comment promise cross-language drift detection that the assertions do not perform
   — that is precisely the "evidence-shaped non-evidence" this ticket's standing requirements exist
   to catch, and a future reader will trust it.

### Non-blocking notes

- The probe's `nextRunAt preserved: true` line is **vacuously true**: `nextRunAt` is absent from
  every schedule response in the transcript (the scheduler never ran during the probe), so the
  check compares absent to absent, and the subsequent "expression changed → RESET" step carries no
  assertion line at all. This does not weaken any acceptance criterion — the asymmetry is
  pre-existing HEL-415 backend behaviour, not this ticket's deliverable, and I verified the
  description's claim about it directly against `PipelineScheduleService.put`'s `cadenceChanged`
  branch. Worth knowing rather than acting on: that transcript line proves less than it reads like.
- `write.ts` (now ~1300 lines) and `helioApi.ts` (~1130) remain well past CONTRIBUTING's ~400-line
  split threshold. The evaluator's suggestion to call this out in the PR description still stands.
- The ticket's own "Verified Ground Truth" section omits that cron fields are comma-separable. The
  shipped description is more accurate than the ticket. No action; noted so the next reader does not
  "correct" the description back to the ticket.
