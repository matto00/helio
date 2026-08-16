## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read fresh (cold): `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-steps-persistence/spec.md` (MODIFIED), `specs/pipeline-editor-page/spec.md`
  (ADDED), `workflow-state.md` (round 1, no prior skeptic history).
- `git log --oneline -5` / `git status` confirm HEAD is `6612e291` (HEL-409, includes merged
  404/405/407/409 as the ticket states) with only the untracked `openspec/changes/
  insert-step-at-position/` dir — no code drift to account for.
- `openspec validate insert-step-at-position --strict` → `Change 'insert-step-at-position' is
  valid` (structural: SHALL/scenarios present, no name collisions).

**Backend — read the actual code the design cites, line by line:**
- `PipelineStepProtocol.scala:143` — `CreatePipelineStepRequest(\`type\`: String, config:
  JsObject)`, `jsonFormat2` at line 313. Confirms the "gains `position: Option[Int]`, bump to
  jsonFormat3" starting point exactly.
- `PipelineService.addStep` (437–522) — confirmed the full chain design.md describes: kind
  check (438) → config decode (443) → join/union/lookup ACL pre-flights (453–496) → owner/editor
  branch (500–519) → `insertInternal` at both the editor-grantee and owner exit points
  (510, 516). Design's "keep the entire chain verbatim, branch only the final persist" is
  achievable without touching any of this.
- `PipelineStepRepository.scala` — `insertInternal` (152–163): `MAX(position)+1 | 0`, exactly as
  claimed (design cited "156-159", the actual MAX/position lines are 156–157 — trivial line-ref
  drift, not a factual error). `reorderInternal` (196–206): one `withSystemContext` transaction,
  `DBIO.sequence` of per-id position updates then a fresh sorted re-read — this is genuinely the
  idiom the design proposes reusing for `insertAtInternal`.
- `deleteInternal`/`delete` (both variants) — confirmed neither renumbers on delete, so the
  "positions can have gaps today" ground truth holds.
- `PipelineService.reorderSteps` (660–690) — confirmed it validates via a fresh
  `listByPipelineInternal` read against `req.stepIds`, and rejects non-permutations with
  `ServiceError.UnprocessableEntity` (679). `ServiceResponse.scala:82` confirms
  `UnprocessableEntity → StatusCodes.UnprocessableEntity` (422). So "422, not clamp, consistent
  with reorderSteps" is a real, verified precedent, not an invented one.
- `PipelineStepRoutes.scala` — `post { entity(as[CreatePipelineStepRequest]) { ... } }` with no
  per-field logic; confirms "no route change" is literally true — the new field arrives for free
  once the format is bumped.
- `backend/.../db/migration/V23__pipeline_steps.sql:4` — `position INT NOT NULL` already exists;
  confirms "no migration" is correct.

**The MODIFIED-vs-RENAMED naming question (item 2 in my brief):** This repo has direct precedent
— `openspec/changes/archive/2026-07-23-scheduler-runtime/skeptic-design-2.md` REFUTEd a prior
change for exactly the opposite mistake: a MODIFIED delta whose header didn't match the base
spec's requirement title verbatim (a silent, unmarked rename), and its Change Request explicitly
offered as an acceptable fix: *"Keep the base spec's exact existing title... and put the
clarification in the requirement body text... rather than the header."* I checked this
insert-step-at-position delta against that standard directly:
`openspec/specs/pipeline-steps-persistence/spec.md:83` — base title is verbatim
`### Requirement: POST /api/pipelines/:id/steps appends a new step`. The change's delta at
`specs/pipeline-steps-persistence/spec.md:5` uses the **identical** title, with all the new
insert-at behavior described in the body/scenarios. This is exactly the accepted pattern from the
precedent, not the rejected one — sound.
- `openspec/specs/pipeline-editor-page/spec.md` — grepped all existing requirement titles; "Steps
  can be inserted between existing steps in the editor" does not collide with any of them, so the
  ADDED (not MODIFIED) classification for that delta is correct too.

**Frontend — read the actual files the design cites:**
- `PipelineDetailPage.tsx` is 626 lines today (`wc -l`) — matches the design's stated base
  exactly. `handleAddStep` (297–318) confirmed to match the described optimistic-temp +
  reconcile-on-success + keep-temp-and-toast-on-failure pattern verbatim.
- `stepsFingerprint` (179–181) is order-sensitive (includes `s.id` per step, joined) and drives
  the debounced `analyzePipeline` effect (182–189) — confirmed "no new code needed" for the
  analyze-refresh claim: any insert changes the fingerprint automatically.
- `StepCard.tsx:153` — `configFingerprint = \`${stepIndex}:${JSON.stringify(step.config)}\`` (the
  HEL-407 mechanism); `PipelineRiverView.tsx:174` passes `stepIndex={idx}` from array position.
  Confirmed: any insert before an open-preview step changes its `idx`, which changes its
  fingerprint, which re-fetches the preview — the "refresh comes free" claim is verified true, not
  asserted.
- `PipelineRiverView.tsx` — confirmed the exact gap structure the design describes: one
  `RibbonSegment` before the first card (161) and between each pair (188, `idx < length-1`), the
  HEL-407 drag drop-indicator rendered in the same `Fragment` per gap (164–166) — the design's
  named risk ("gap affordance must not interfere with the drop-indicator, both live in the gaps")
  is real and correctly identified, with a concrete verification plan (live pass, all breakpoints).
  `OpDropdown` (`OpDropdown.tsx`) takes a single `anchorRef: RefObject<HTMLButtonElement | null>`
  — reusable for a gap button via a shared, click-reassigned ref, consistent with "same anchorRef
  pattern."
- `pipelineService.ts:61-71` — `createPipelineStep` posts a plain `{ type, config }` object
  literal today; adding an optional `position` param that's spread in only when defined is a
  trivial, correctly-scoped change, and confirms the "wire byte-identical for append" claim.
- One factual drift: design.md's sizing table states `PipelineRiverView.tsx 219 → ~+35`; actual
  current line count is **228**, not 219 (`wc -l` confirmed). Non-blocking — doesn't affect any
  task's correctness, and `files-modified.md` (task 3.4) is the actual record of truth for growth;
  flagged as a note below so the executor doesn't propagate the stale baseline.

**Schema plan (item 4 in my brief):**
- `schemas/` has no `create-pipeline-step-request.schema.json` today (confirmed via `ls`); the
  existing `reorder-pipeline-steps-request.schema.json` is a reasonable model for the new file's
  conventions (optional `position`, minimum 0).
- Read `scripts/check-schema-drift.mjs` in full. It matches each `schemas/*.schema.json`'s
  `title` to a same-named `case class` (regex-parsed from `JsonProtocols.scala` +
  `api/protocols/*.scala`) and diffs the **set of property names** (not types/required-ness).
  Ran it fresh (`node scripts/check-schema-drift.mjs`) → `schemas in sync with JsonProtocols (60
  checked across 45 protocol files)` — clean baseline. Once `CreatePipelineStepRequest` gains
  `position`, a schema titled `"CreatePipelineStepRequest"` must declare **all three** properties
  (`type`, `config`, `position`) or the checker fails loudly with a clear message ("missing from
  schema: type, config" or similar) — task 1.4's phrasing ("optional integer position, min 0;
  model on the reorder request schema") reads a bit narrowly (as if only `position` needs
  modeling), but the spec delta's own body (`{ type, config, position? }`) and the very nature of
  a "create request" schema make the full shape unambiguous on a careful read, and the checker's
  failure mode is loud/actionable rather than silent. Non-blocking; noted below for precision.

### Verdict: CONFIRM

The design is grounded correctly against the actual code at every load-bearing claim I checked
(insertInternal/reorderInternal idiom, addStep's ACL chain, the 422/UnprocessableEntity
precedent, the fingerprint-based free-refresh mechanism, the no-migration/no-route-change claims,
and the MODIFIED-not-RENAMED spec naming choice, which is the pattern this repo's own prior
skeptic review established as *correct*). All five ACs trace to concrete tasks/scenarios. No
placeholders, no internal contradictions, no scope drift beyond what the ticket's frontend/backend
scope lines call for (the `handleAddStep`→`handleInsertStep` consolidation is small, deliberate,
and justified against a real near-duplication risk, not a bundled refactor).

### Non-blocking notes

1. **TOCTOU on the service-layer count validation vs. the repo's fresh read** (design.md Decision
   1/2). The service validates `0 ≤ position ≤ count` against a count it reads itself, then
   `insertAtInternal` re-reads the pipeline's steps fresh inside its own transaction to build the
   spliced sequence. Under a race (a concurrent delete between the service's read and the repo's
   transaction), the validated index could be stale relative to the repo's fresh list. This can't
   corrupt data (renumbering 0..n from scratch always yields a valid contiguous order — same
   "accepted" framing the Risks section already gives to concurrent inserts), but the specific
   delete-during-insert interleaving isn't named in the Risks section (only concurrent
   inserts-vs-inserts is). Worth a one-line addition to Risks for completeness; not blocking.
2. **`PipelineRiverView.tsx` sizing baseline is stale** — design.md says 219 lines; actual is 228.
   Use the real current count when recording growth in `files-modified.md` (task 3.4).
3. **Schema task 1.4 wording** — make explicit that the new schema must declare `type` and
   `config` alongside `position` (the full `CreatePipelineStepRequest` shape), not just the new
   field, to avoid a first-pass `check:schemas` failure. The checker's error output is
   self-correcting either way, so this is precision, not a blocker.
4. **`handleAddStep` → `handleInsertStep(op, steps.length)` consolidation** trades today's
   always-correct functional-update append (`setSteps(prev => [...prev, tempStep])`, immune to
   stale closures) for computing the append index (`steps.length`) from the outer closure before
   calling the shared handler. In the ordinary single-click case this is fine; under a
   pathological rapid-double-click race the temp step could transiently splice at a stale index
   rather than the true end (self-corrects on reconciliation, which matches by step id, not
   index). Low severity, not blocking, but worth a mental note for the executor since the design
   explicitly labels this consolidation "behavior-preserving."
