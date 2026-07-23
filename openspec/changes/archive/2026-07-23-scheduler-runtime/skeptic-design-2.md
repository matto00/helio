## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read fresh (cold, not trusting round-1 report as fact): `ticket.md`, `proposal.md`,
  `design.md`, `tasks.md`, `specs/pipeline-scheduler-runtime/spec.md`,
  `specs/pipeline-schedule-crud-api/spec.md`, `specs/pipeline-schedule-persistence/spec.md`,
  `workflow-state.md`, and (for ground truth) `openspec/specs/pipeline-schedule-crud-api/spec.md`,
  `openspec/specs/pipeline-schedule-persistence/spec.md` (the pre-change base specs).
- Confirmed the branch point is still clean and un-drifted: `git log --oneline -3` → HEAD is
  `d908eb35` (HEL-414 merge), `git status --short` shows only the untracked
  `openspec/changes/scheduler-runtime/` directory — no code has moved since round 1, so all of
  round 1's code-level findings (ApiRoutes/Main.scala/PipelineRunService/PipelineRunRepository
  shapes) remain valid without re-deriving them from scratch; I independently re-spot-checked the
  two claims most load-bearing for this round's fix (below).
- **Re-confirmed the bug the round-1 REFUTE was about, directly in the current code**
  (`backend/src/main/scala/com/helio/services/PipelineScheduleService.scala:59-60`):
  ```scala
  nextRunAt  = existingOpt.flatMap(_.nextRunAt),
  lastRunAt  = existingOpt.flatMap(_.lastRunAt),
  ```
  `put` unconditionally preserves `nextRunAt` on every replace today, exactly as design.md
  Decision 7 and proposal.md describe as the defect being fixed — the fix task (4.1) is a real,
  needed code change, not already-satisfied busywork.
- **Design.md Decision 7** now explicitly names the fix: `put` compares `kind`/`expression`/
  `timezone` against the existing row and resets `nextRunAt` to `None` only when one differs;
  `lastRunAt` and unrelated edits (e.g. `enabled`-only) are untouched. This composes correctly with
  Decision 2's existing "unset → recompute forward without firing" rule — no new state machine,
  no double-fire risk (an edit alone never fires a run, it only makes the *next* tick recompute
  under the new cadence). I traced the interaction through by hand: edit cadence → `nextRunAt=None`
  → next tick sees `IS NULL` → recomputes forward from now, does not fire → subsequent tick fires
  correctly under new cadence. This is a materially better outcome than round 1's code (which would
  have kept firing on the stale, pre-edit occurrence).
- **Proposal.md** `Modified Capabilities` now correctly lists both `pipeline-schedule-crud-api` and
  `pipeline-schedule-persistence` (round 1 flagged the "unchanged" claim as false/misleading given
  the intended fix) — the "unchanged normative behavior, only the framing was stale" wording for
  `pipeline-schedule-persistence` matches what the persistence delta spec actually says.
- **Tasks.md** section 4 (new) directly implements Decision 7 (task 4.1); task 6.3 (new) adds the
  two required test cases to the *existing* `PipelineScheduleServiceSpec` file (cadence-change
  resets `next_run_at`; `enabled`-only change preserves it) — this closes round 1's ask that the
  fix be both implemented and verified by regression tests, not just asserted.
- `specs/pipeline-schedule-crud-api/spec.md` — `MODIFIED Requirements: Create or replace pipeline
  schedule` header **matches verbatim** the existing base-spec requirement title in
  `openspec/specs/pipeline-schedule-crud-api/spec.md:27` ("Create or replace pipeline schedule") —
  correct use of the MODIFIED mechanism. New scenarios ("Cadence change resets next_run_at",
  "Unrelated edit preserves next_run_at") are additive and consistent with Decision 7.
- Ran `openspec validate scheduler-runtime --strict` → `Change 'scheduler-runtime' is valid`
  (structural validation: SHALL/MUST present, ≥1 scenario per requirement, no ADDED/MODIFIED/
  REMOVED name collisions). Confirmed by reading
  `/usr/lib/node_modules/@fission-ai/openspec/dist/core/validation/validator.js` that this
  structural check does **not** cross-reference MODIFIED requirement titles against the base spec
  file at all — a passing `validate --strict` is not evidence the requirement names actually match
  the base specs, so I checked that by hand (see gap below).
- Ran `grep -rniE "TODO|TBD|figure out|to be determined|placeholder"` across the whole change dir
  → no hits (the only matches are the round-1 report's own self-quoting of that same grep).
- Traced all six ticket ACs to concrete spec.md requirements/scenarios and tasks.md items — same
  coverage round 1 already verified, unchanged and still complete: auto-fire (spec req 1 / task
  3.2), no-overlap (spec req 2 / design Decision 3 / tasks 2.3, 3.3), restart-safe catch-up (spec
  req 3 / design Decision 2 / task 6.2), failure recorded (spec req 4 / task 6.2), deterministic
  tests via injectable Clock (design Decision 6 / task 3.1, 6.2), backward-compatible/additive
  (spec `pipeline-scheduler-runtime` scenario "Pipeline without a schedule is never auto-run" /
  task 6.2 last bullet).

### Gap found — the persistence delta's MODIFIED requirement doesn't match any base-spec requirement name

`specs/pipeline-schedule-persistence/spec.md` (new this round) has:
```
### Requirement: next_run_at and last_run_at are computed by the scheduler runtime, not the repository
```
but the actual base spec it's meant to modify, `openspec/specs/pipeline-schedule-persistence/
spec.md:57`, has:
```
### Requirement: next_run_at and last_run_at are not computed by this ticket
```
These are different requirement names. Per OpenSpec's own documented convention (the `sync-specs`
skill template, which the archiving agent — including `opsx-archive`, referenced in this repo's
`CLAUDE.md` — literally runs off): **`MODIFIED Requirements` works by *finding the requirement in
the main spec by name* and updating it in place.** A title change like this is exactly what the
separate `RENAMED Requirements` mechanism exists for ("Find the FROM requirement, rename to TO"),
and this delta doesn't use it. `openspec validate --strict` passes only because it does no such
cross-file name lookup (verified by reading the validator source) — it is not evidence this delta
will reconcile correctly.

Concretely, at archive time this can go one of two ways, both bad:
1. The archiving process can't find "next_run_at and last_run_at are computed by the scheduler
   runtime, not the repository" in the base spec (because it isn't there), so it's not applied as
   a true in-place modification — worst case, the stale-titled requirement ("...are not computed by
   this ticket") survives archival verbatim, sitting right alongside the new scheduler-runtime spec
   that says the runtime *does* compute them — a self-contradictory main spec.
2. An LLM-driven archiver "fuzzy matches" the two by content similarity and gets it right anyway —
   plausible, but relying on fuzzy inference to route around an unused, purpose-built mechanism
   (`RENAMED`) is exactly the kind of ambiguity this gate exists to catch before it's someone else's
   problem three steps downstream.

This is a real defect in this round's own fix, not a round-1 leftover: round 1 didn't have this
delta file at all. It's directly in-scope for this review because it's part of what round 2 added
specifically to close the round-1 gap, and per the ticket-chain context in `ticket.md` (HEL-416,
the very next ticket, will read the archived `pipeline-schedule-persistence` spec), a contradictory
merged spec is a foreseeable, concrete downstream cost — the same standard round 1 applied to the
`next_run_at` staleness gap itself.

### Verdict: REFUTE

### Change Requests

1. **Fix the persistence delta's requirement-matching mechanism**
   (`specs/pipeline-schedule-persistence/spec.md:3`). Either:
   (a) Keep the base spec's exact existing title — `### Requirement: next_run_at and last_run_at
   are not computed by this ticket` — under `## MODIFIED Requirements`, and put the "now computed
   by the scheduler runtime, not the repository" clarification in the requirement *body* text
   (which the delta already does well) rather than the header; or
   (b) Add an explicit `## RENAMED Requirements` section (`FROM: next_run_at and last_run_at are
   not computed by this ticket` / `TO: next_run_at and last_run_at are computed by the scheduler
   runtime, not the repository`) alongside the `## MODIFIED Requirements` section, per OpenSpec's
   documented rename convention, so the title change is explicit and archivable deterministically
   rather than left to inference. Either is acceptable; the current unmarked rename is not.

### Non-blocking notes

- Same two items round 1 flagged as non-blocking remain accurate and still un-escalated to
  blocking (neither needed action this round, both still worth the executor's attention):
  the overlap-guard test technique's reliance on real `Future`/`ExecutionContext` race timing
  (Decision 8), and the 30s default tick interval being coarser than the minimum accepted interval
  expression (`1s`) — worth a one-line mention in Risks alongside the other three documented
  limitations, but not required for this gate.
- The `pipeline-schedule-crud-api` delta's MODIFIED requirement title, by contrast, is a correct,
  verbatim match to the base spec — worth calling out as the pattern the persistence delta should
  have followed.
