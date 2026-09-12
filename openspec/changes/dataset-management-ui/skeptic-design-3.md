## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/dataset-management-ui-schema/HEL-1079`.
- Read all four artifacts fresh (`proposal.md`, `design.md`, `tasks.md`,
  `specs/dataset-management-ui/spec.md`) plus `ticket.md` and the binding backend contract
  `openspec/specs/dataset-schema-api/spec.md`. `skeptic-design-2.md` read for context only;
  every file:line below was re-derived from the current worktree.
- HEAD reviewed: `d3c8e4ae`.

**Each of the orchestrator's 8 claimed fixes, verified against current file contents:**

1. **proposal.md two-mechanism split — PRESENT.** `proposal.md:12-18` now describes
   "predicts and blocks/confirms client-side (add-required-with-no-default, drop-with-data —
   both fully determined by the dataset's own row count)" vs "submits and surfaces the server's
   decision inline (retype, tighten-to-required)". This matches design.md Decision 3's table
   (`design.md:62-68`) row-for-row. Round-2 CR1 resolved.
2. **rename/reorder structural-400 — CONSISTENT in both files.** `design.md:68` now reads "No
   client-side *prediction* or confirmation needed … They CAN still fail structurally with a
   `400`". `spec.md:115-121` states the same and routes the failure to "the structural-`400`
   requirement above". Both agree with the backend contract at
   `dataset-schema-api/spec.md:55-70` (malformed identity mapping → `400`, incl. rename target
   colliding with a dropped field). Round-2 CR2 resolved; no residual contradiction.
3. **Decision 6 focus targets — CORRECT and three-way consistent.** `design.md:127-138`
   separates reorder (moved row's own name `TextField`) from remove (next remaining field's
   name input, or "Add field" if none remain), and specifies the confirm-drop dialog's
   cancel/confirm targets. `tasks.md:19-24` (task 1.3) matches word-for-word in substance.
   `spec.md:153-163`'s two focus scenarios match both. Round-2 CR3 resolved.
4. **Risks citation — FIXED.** `design.md:162` now cites "task 1.5 below"; task 1.5
   (`tasks.md:29-36`) is indeed the one specifying the row-cell permute *and* its test.
5. **Dangling toast cross-reference — FIXED.** `design.md:72-73` now points at "task 2.4",
   and `tasks.md:55-62` (task 2.4) does carry the exact wording ("No rows affected" for `0`,
   "`<n>` rows updated" otherwise). No dangling pointer remains.
6. **All-or-nothing scenario recast to a reachable state — FIXED.** `spec.md:108-113` now pairs
   an allowed optional-field add with an incompatible retype, and explicitly parenthesizes why
   the old drop-without-confirmation WHEN is unreachable. This request is one the UI can
   genuinely issue (retype is attempt-then-surface per Decision 3), so the scenario is now
   verifiable against this capability.
7. **Task 1.1 cross-check mechanism — NAMED.** `tasks.md:3-13` now requires either parsing
   `model.scala`'s `CanonicalWireValues` (mirroring `scripts/check-schema-drift.mjs`) or a
   shared `schemas/` enum, and forbids a hand-copied twin. Both cited artifacts exist:
   `scripts/check-schema-drift.mjs` (present, 27891 bytes) and
   `backend/src/main/scala/com/helio/domain/model/model.scala:735-736` —
   `CanonicalWireValues = Vector(String, Integer, Float, Boolean, Timestamp, StringBody, BinaryRef).map(asString)`,
   7 values in `asString` order, exactly as Decision 4 claims.
8. **Citation corrections — one improved, one regressed (see notes).** The "Decision 4's
   shared-constant reasoning" misattribution is fixed: `design.md:157` now reads "Decision 1's
   rationale and task 1.2", which is correct. The `StaticSourceForm.tsx` line fix is now
   *wrong in a new way* — see non-blocking note 1.

**Independent premise checks (not among the 8 fixes, re-derived myself):**

- `StaticColumn.type` is still `StaticColumnType` (4 types) at `types/dataSource.ts:159,166`;
  `DatasetFieldType` (7 types) at `:237-244`. Task 1.4's widening is genuinely required.
- Design.md Decision 4 / task 1.5's premise that `StaticColumn` **already** carries optional
  `required`/`default` is TRUE: `types/dataSource.ts:164-169` (`required?: boolean`,
  `default?: unknown`, HEL-1076). So "carrying `required`/`default` through on submit (already
  supported by `StaticColumn`)" is accurate, not wishful.
- `DatasetSchemaResponse` (`:256-258`) is `{ fields: DatasetFieldResponse[] }` — carries no row
  count, so Decision 3a's insistence on `datasetRowsSlice.ts`'s `total` (`state/datasetRowsSlice.ts:41`,
  populated `:318`) rather than the schema response is correct and necessary.
- Only two schema service functions exist: `dataSourceService.ts:381` (`fetchDatasetSchema`),
  `:392` (`updateDatasetSchema`). No dry-run route — Decision 3's whole premise holds.
- Ticket AC coverage traced: keyboard-only (tasks 3.2/3.3, spec.md:133-147); accessible names
  (task 3.1, spec.md:148-151); create with all four field attributes + reorder/remove
  (tasks 1.2/1.5, spec.md:9-38); each of the seven ticket policy bullets at `ticket.md:17-23`
  maps to a Decision 3 table row or a spec.md scenario; the "preview where the API supports it"
  AC (`ticket.md:24`) is honestly answered by the two-mechanism split rather than over-claimed.
  No AC is uncovered, and I found no task outside the ticket's scope.

### Verdict: CONFIRM

All six round-2 change requests and both non-blocking items are genuinely resolved against
ground truth, and I could not construct a reading in which proposal.md, design.md, spec.md,
tasks.md and the backend contract contradict each other on any load-bearing point. The
two-mechanism split, the row-count-based drop trigger, the structural-`400` handling, and the
focus contract are now stated identically in every file that mentions them. The residual items
below are citation/wording polish: none of them could send a competent implementer down a wrong
path, because in each case the artifact's prose already states the intended behavior
unambiguously and the surrounding task carries the real test.

### Non-blocking notes

1. **The `StaticSourceForm.tsx` line citation is now inconsistent *between* design.md and
   tasks.md, and neither is quite right.** Ground truth (re-derived):
   `removeColumn` is declared at line 43, and its two re-slice statements are lines 44-45,
   closing brace 46 — line 42 is blank. `design.md:161` now cites `:42-45`; `tasks.md:33` cites
   `:43-46`. tasks.md's is the better of the two (it spans the actual function block); design.md's
   fix #8 moved it off by one in the other direction. Note that round-2's report asserted `:42-45`
   as ground truth — that assertion was itself slightly wrong, which is why I re-derived it rather
   than adopting it. Suggest both files converge on `:43-46`. Purely cosmetic: the prose names
   `removeColumn` explicitly, so the implementer will find it regardless.
2. **spec.md's reorder scenario implies a third toast string that task 2.4 doesn't enumerate.**
   `spec.md:128-131` says the user "is told existing rows were rewritten to the new column order",
   while task 2.4 (`tasks.md:57-58`) specifies only two strings ("No rows affected" for `0`,
   "`<n>` rows updated" otherwise). "`<n>` rows updated" does satisfy the scenario's substantive
   requirement (the user is told the row count), so this is not a contradiction — but if a
   reorder-specific message is actually wanted, task 2.4 should say so. I'd leave it as-is;
   fewer toast variants is the better UI.
3. `design.md:105-106` cites `types/dataSource.ts:159,164` for `StaticColumn.type`; the `type`
   field itself is `:166` (`:164` is the interface declaration). Harmless.
4. Decisions 1, 2, 3a, 4 and 5 continue to hold up against ground truth, as does the
   "no dashboard navigation on create" correction (`design.md:140-146`), which I did not re-verify
   in code this round beyond confirming spec.md:14-20 still matches its stated behavior — round 2
   verified `SourcesPage.tsx:154` renders `AddSourceModal` with no `onCreated`, and nothing in
   this round's diff touches that file.
