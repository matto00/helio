## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/dataset-management-ui-schema/HEL-1079`.
- Read all current artifacts fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/dataset-management-ui/spec.md`, plus the binding backend contract
  `openspec/specs/dataset-schema-api/spec.md`. Read `skeptic-design-1.md` for context only; every
  file:line below was re-derived from the current worktree, not from that report.
- Backend canonical type set re-verified: `backend/src/main/scala/com/helio/domain/model/model.scala:735-736`
  — `CanonicalWireValues = Vector(String, Integer, Float, Boolean, Timestamp, StringBody, BinaryRef)`,
  7 values in `asString` order; `canonicalizeLegacy` (`:705-710`) maps `"number"|"double" => "float"`
  and passes anything else through unchanged, so the backend will indeed never reject a
  non-canonical-but-synonymous UI value. Round-1 CR5's premise holds.
- `StaticColumn.type` is still `StaticColumnType` (4 types) at `frontend/src/features/sources/types/dataSource.ts:159,166`;
  `DatasetFieldType` (7 types) at `:237-244`. The widening in task 1.4 is genuinely required and
  not yet done. `DatasetSchemaResponse` (`:255-257`) is `{ fields: DatasetFieldResponse[] }` and
  carries no row count — Decision 3a's corrected premise is accurate.
- Row count source re-verified: `frontend/src/features/sources/state/datasetRowsSlice.ts:41` (`total`),
  populated at `:318` from the page response. (Note the path is `state/`, not `store/`; design.md
  cites the bare filename, so no citation error.)
- `removeColumn`'s existing row re-slice confirmed at `frontend/src/features/sources/ui/forms/StaticSourceForm.tsx:42-45`
  (design.md cites `:43-46` — off by one line, harmless).
- Create-flow navigation re-verified: `AddSourceModal.tsx:104-110` (`finishCreate` calls the optional
  `onCreated`), and `SourcesPage.tsx:154` renders `<AddSourceModal onClose={...} />` with **no**
  `onCreated`. Round-1 CR8's correction is factually right; spec.md's create scenario now matches.
- Only two schema functions exist in the service layer: `dataSourceService.ts:381` (`fetchDatasetSchema`)
  and `:392` (`updateDatasetSchema`). No dry-run route — Decision 3's premise holds.
- CR3 (row-count-based drop trigger), CR6's six added scenarios, and CR7's Decision 6 + task 1.3 +
  two focus scenarios are all present in the current artifacts.

### Verdict: REFUTE

Six of the eight round-1 change requests are genuinely and correctly resolved (CR2, CR3, CR4, CR5,
CR6, CR8 — each checked against code, not against the round-1 report). CR1 and CR7 are resolved in
some artifacts but not all, and the CR1/CR6 fixes introduced two new, load-bearing contradictions
between spec.md, design.md and the backend contract. These are exactly the "implementer could read
this two ways" defects this gate exists to catch, so they block.

### Change Requests

1. **proposal.md still carries the round-1 CR1 contradiction verbatim — it was fixed in spec.md and
   design.md only.** `proposal.md:12-14` states the schema-edit surface "previews the effect of an
   edit (**incompatible-row counts**, `rowsMigrated`) before committing". design.md Decision 3's
   table (`design.md:66`) explicitly classifies retype as **attempt-then-surface**, precisely
   because incompatible-row counts require the server's per-value check and cannot be previewed
   before commit; spec.md:78-82 agrees (the count arrives in the `409`'s `rejectedFields`, after
   submission). Revise proposal.md's "What Changes" bullet to describe the two-mechanism split
   (predicted/blocked client-side vs. attempt-then-surface) rather than a blanket pre-commit
   preview of incompatible-row counts.

2. **"Rename and reorder are never rejected by the API" is false, and contradicts spec.md's own
   structural-400 scenario added for CR6.** design.md:68 (Decision 3's table, last row) says of
   rename/reorder: "No rejection is possible (see spec.md's new scenarios)", and
   spec.md:114-117 states the API rejects "neither ... ever". But `dataset-schema-api/spec.md:55-70`
   rejects with `400` a rename whose `previousName` names no existing field, two fields sharing a
   `previousName` or `name`, **or a rename target colliding with a field being dropped** — and
   spec.md's *own* scenario at `:96-101` specifies exactly that rename-driven `400`. As written the
   two requirements in the same spec file contradict each other, and an implementer following
   Decision 3's table would ship the rename path with no error handling at all. Restate as: rename
   and reorder need no client-side *prediction* or confirmation (no data-loss/compatibility
   rejection is possible), but they can still fail structurally with a `400`, which lands in the
   same inline error banner as the other `400`s.

3. **Decision 6's remove-focus target is impossible as written and contradicts spec.md.**
   design.md:126-133 says "after any reorder **or remove** action, focus moves to the affected row's
   own name `TextField`" — for a removal the affected row no longer exists, so there is no such
   input to focus. spec.md:155-158 specifies the correct behavior ("the next remaining field's name
   input, or the 'Add field' control if none remain"), and task 1.3 (`tasks.md:14-17`) inherits
   design.md's wrong wording ("the affected row's name input"). Correct Decision 6 and task 1.3 to
   state the removal case separately, including the zero-fields-remaining fallback, so they match
   spec.md one-for-one.

4. **design.md's Risks section cites the wrong task for the reorder/row-alignment mitigation.**
   `design.md:158-160` says the reorder permute of already-entered row data is covered by "task 1.3
   below" — task 1.3 (`tasks.md:14-17`) is the focus/live-region task. The permute is actually
   covered by task 1.5 (`tasks.md:22-29`), which does specify it correctly *and* has the test
   ("reordering columns after entering row data keeps each row's cells aligned"). Fix the
   cross-reference to 1.5. (The risk itself IS reflected in a task — only the pointer is wrong.)

5. **design.md contains a dangling self-reference for the success-toast wording.** `design.md:72-73`
   says `rowsMigrated` is "toasted — see the table in design.md's spec cross-reference for exact
   wording per case". No such table exists anywhere in design.md. The wording actually lives in
   task 2.4 (`tasks.md:50-51`: "No rows affected" for `0`, "`<n>` rows updated" otherwise). Point at
   task 2.4, or inline the wording, so the implementer isn't sent to a section that does not exist.

6. **spec.md's all-or-nothing scenario describes a state this UI makes unreachable by
   construction.** `spec.md:108-112`: "**WHEN** a single schema-edit submission both adds an allowed
   optional field and drops a field with data without confirmation — **THEN** the response is `409`".
   But Decision 3a and task 2.2 require the client to block/confirm *before* sending whenever any
   field is removed and `datasetRowCount > 0`, so this UI can never issue that request; the scenario
   is unverifiable against the capability it specifies (it restates backend behavior already
   specified at `dataset-schema-api/spec.md:254-263`). Either re-cast the scenario around a
   rejection this UI can actually produce (e.g. a retype-rejection combined with an allowed added
   field — both submitted together, `409`, nothing shown as applied), or state the invariant without
   a WHEN the UI prevents.

### Non-blocking notes

- Task 1.1's structural guard does not name **how** a frontend test reads the backend's
  `CanonicalWireValues`. A Jest test that simply re-lists the 7 strings is a same-spec twin and
  proves nothing. There is precedent for the real thing in `scripts/check-schema-drift.mjs`, so this
  is implementable — consider naming the mechanism (parse `model.scala`, or derive both from a
  `schemas/` enum) so it can't quietly degrade into a hardcoded copy.
- design.md:155 attributes the "extract the field-declaration table into its own component"
  mitigation to "Decision 4's shared-constant reasoning"; Decision 4 is about type widening, the
  component extraction is Decision 1/task 1.2. Cosmetic.
- design.md cites `StaticSourceForm.tsx:43-46` for `removeColumn`'s re-slice; it is `:42-45`.
  Cosmetic, but note file:line citations in these artifacts have drifted once already.
- Round-1 CR2/CR3/CR4/CR5/CR6/CR8 are all correctly and completely resolved against ground truth;
  Decisions 1, 2 and 5 continue to hold up. The two-mechanism split in Decision 3's table maps
  one-for-one onto spec.md's two now-separate requirements (rows 1-2 → `spec.md:40-65`, rows 3-4 →
  `spec.md:67-101`) — that part of the CR1 fix is sound; only the rename/reorder row (CR #2 above)
  and proposal.md (CR #1 above) are wrong.
