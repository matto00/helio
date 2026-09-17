## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `b9dc15535571fb20fda84f8c3b5f42c2e967e92c`
Diff base (resolved LIVE via `resolve-review-base.sh`, CON-152): `e6aaf2f4d740f145a9fd157dce109878d893d419`
45 files, 2781 insertions. Worktree clean at review time and unchanged at report time.

---

### Phase 1: Spec Review — FAIL

**Acceptance criteria — both halves verified, the second one behaviourally.**

- **AC1 (`POST /api/panels` round-trip): PASS.** Verified over real HTTP against the running
  backend (`:9422`), not only by unit test. Created a `form` panel with four ordered fields
  exercising `step`/`required`/`label`/`helpText`/`placeholder`/`initialValue`/`options`/`file`.
  Sent config == create-response config byte-for-byte (sorted-JSON compare).
- **AC2 (dashboard export/import): PASS — and this is the half the brief flagged as most
  likely to be wrong.** Verified end to end over real HTTP, not by compile and not only by unit
  test: `GET /api/dashboards/1ad45b0d.../export` → 200, `POST /api/dashboards/import` → **201**
  (no `MatchError`), and the imported dashboard's form config is **identical** to what was sent:

  ```
  sent==created : True
  sent==exported: True
  sent==imported: True
  imported field order: ['quantity', 'note', 'choice', 'attachment']
  quantity step/required: 2.5 / True
  submit: {"label": "Add row", "resetOnSuccess": true, "writeMode": "append"}
  ```

  The import-side `DashboardSnapshotRepository` `FormCreate` arm is **proven load-bearing**, not
  merely present: my own mutation 4.7 (below) turns the export/import test RED. So the plan
  defect the brief handed me is real and is correctly fixed in the implementation — but it is
  still mis-stated in the planning artifacts (CR2).

**Task completion:** 34/34 `[x]`, 0 unchecked. Each task's claimed artifact exists in the diff.

**Scope ruling on the files beyond proposal.md's Impact list (requested explicitly).** All
three production files are **mechanically required, not scope creep**:

- `ApiRoutes.scala` — one-line DI: `panelService` must receive `dataSourceRepo` or D6/task 1.10's
  ownership check can never fire in production (the parameter is nullable-optional, so without
  this line the check would silently no-op — exactly the failure mode the constraint exists to
  prevent). Justified.
- `PanelService.scala` — the substance of task 1.10 (`rejectMissingDataSource`, called from
  `buildForCreate` and `update`). Justified; the task mandates it.
- `DashboardSnapshotRepository.scala` — required for AC2 per above; mutation-proven load-bearing.
  Justified.
- Test-support files (`panelFixtures.ts`, `PanelContent.test.tsx`, `mobilePanelHeights.test.ts`,
  `ApplyProposalSpecBase.scala`) — all are test scaffolding for tasks 4.x. `ApplyProposalSpecBase`
  only *adds* two exposed fixtures and one seeded row; it changes no existing fixture's behaviour.
  Justified.

Every one is declared in `files-modified.md` with a rationale. **No scope creep found.** However,
the *Impact list itself* is now wrong in both directions, which C12 makes a blocking finding
(CR1).

**Constraint compliance (C1–C12, `workflow-state.md`; C1 retired):**

| Constraint | Verdict | Evidence |
| --- | --- | --- |
| C2 mutation-proven guards | **Partial — see CR4** | Mutations are genuine (I re-ran all three), but the promised transcripts are recorded nowhere |
| C3 one migration | PASS | V108 alone carries both changes |
| C4 both column tuples | PASS | `PanelRepository.scala:335` and `:355`; mutation-proven (4.8) |
| C5 lucide environmental | PASS (n/a) | No frontend failure occurred; no lucide export referenced |
| C6 proposal passthrough binds | PASS | Three route-level specs incl. cross-owner not-found |
| C7 mutation must traverse | PASS | Confirmed precisely — see 4.7 below |
| C8 unknown attrs rejected | **FAIL at config top level — CR3** | Field attrs → 400; top-level keys silently dropped |
| C9 deferrals recorded | PASS | `PanelPacker`/`PanelDetailModal`/`RefinementEditShape`/`create_content_panel` all named in design.md with reasons; all four confirmed untouched in the diff |
| C10 if-chain not typecheck-protected | PASS | Branch added by hand; mutation-proven red; confirmed in the running app |
| C11 tolerant read designed | PASS | `PanelRowMapper.formConfig` catches `DeserializationException` → `Empty` + logged warning |
| C12 re-check scope labels/Impact | **FAIL — CR1** | Impact list omits 3 prod + 4 test files and names one never touched |

**Spec deltas** (`form-panel-type`, `output-panel-placement`) match the implemented behaviour,
with the single exception in CR3.

**Issues:**
1. proposal.md's Impact list is inaccurate in both directions (CR1) — a direct C12 violation.
2. design.md's Context still asserts export/import needs no per-kind wire work (CR2) — false.

---

### Phase 2: Code Review — FAIL

**Gates — all re-run by me from scratch in the worktree; the executor's numbers were NOT trusted.**
Every figure below is from my own run:

| Gate | Result |
| --- | --- |
| `cd backend && sbt test` | **4602 tests, 310 suites, 0 failed, 0 aborted** — "All tests passed" (497s) |
| `npm run lint` | exit 0 (`--max-warnings=0`) |
| `npm run format:check` | exit 0 — all files Prettier-clean |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — helio-mcp **271/271** (28 suites); frontend **3458/3458** (321 suites) |
| `npm --prefix frontend run build` | exit 0 (PWA precache 28 entries) |
| `npm run check:schemas` | exit 0 — 96 across 50 protocol files, 7 panel-type surfaces, 14 assistant surfaces |
| `npm run check:scala-quality` | exit 0 — clean, 174 pre-existing soft warnings, none from this change |
| `npm run check:helio-mcp-types` | exit 0 |

Per MISTAKES.md I checked assertion counts rather than mere absence of failure: 4602 backend
assertions actually ran (up from the pre-change baseline by the new `FormPanelSpec`,
`FormPanelRoundTripSpec` and `PanelRowMapperSpec` additions), and the new suites' tests are
individually named in the log — not skipped, not pending (0 canceled / 0 ignored / 0 pending).

**Mutation evidence — independently re-run by me, never transcribed.** All mutations were applied
in a throwaway detached worktree under the scratchpad, never in the delivery worktree (I am
read-only there); the worktree was removed afterward.

- **Task 4.7** (delete the `FormPanel.Kind` arm from `PanelRowMapper.rowToDomain:46-47`):
  0 compile errors, 17 tests run, **11 passed / 6 FAILED**. Red: all three `PanelRowMapperSpec`
  form tests, 4.3b's re-read, 4.8's PATCH-persistence test, **and 4.4's export/import test**.
  Green and untouched: 4.3a create round-trip, no-Output-binding, cross-owner 404, empty
  `dataSourceId` 400. **This matches C7's prediction exactly**, including the subtle part — 4.3a
  stays green because `PanelRepository.insert` echoes the in-memory panel and there is no
  authenticated GET, so it never reaches `rowToDomain`. Claim confirmed, not transcribed.
- **Task 4.8** (drop `form_config` from BOTH `configColumnsOf` and `configColumnValuesOf` —
  removing it from only one is a compile error, so the honest C4 mutation is both):
  0 compile errors, 10 tests run, **9 passed / exactly 1 FAILED** — "should persist a config
  PATCH's new fields — not just echo them in the response". Precisely task 1.8's test and nothing
  else. This is the real HEL-296/HEL-909 silent-stale-write guard and it is genuinely failable.
- **Task 4.10** (delete the `isFormPanel` branch from `PanelContent.tsx`): baseline 27/27 green →
  mutated **1 failed / 26 passed** with `TestingLibraryElementError: Unable to find an accessible
  element with the role "status"` → restored 27/27 green. Genuinely failable; `tsc` indeed cannot
  catch it (C10).

**D9's three layers — verified in source and behaviourally:**
- (i) `FormFieldSpec.format.read` (`FormPanel.scala:64-110`) is strict: unknown key →
  `deserializationError`, a plain decode error with no HTTP meaning.
- (ii) `decodeCreate`/`Patch.decode` reach a 400 via the pre-existing `PanelConfigCodec.safe`
  (`PanelConfigCodec.scala:55`, `:79-84`). Confirmed live: unknown field attr `min` →
  **400 `{"message":"Unrecognized form field attribute(s): min"}`**.
- (iii) `PanelRowMapper.formConfig` (`:126-136`) catches `DeserializationException`, logs a
  warning naming the panel id, and returns `Empty` — so a future/rolled-back row is readable,
  not a 500-on-read. Covered by a real test (4.9) that passes.

**Code quality:** DRY (mirrors the `outputId*` helpers rather than re-deriving), readable, modular;
no TODO/FIXME/dead code in added lines; no `any`/`@ts-ignore`/`eslint-disable` in added
frontend/mcp lines; the three `asInstanceOf` uses are the idiomatic spray-json `Map[String,
JsValue]` variance workaround plus the companion pattern every sibling panel already uses. No
inline FQNs (`check:scala-quality` enforces this mechanically and passes).

**`FormPanel.scala` at 338 lines — my ruling: ACCEPTABLE, no split required.** CONTRIBUTING.md
line 24 sets ~250 as a soft budget and ~400 as the propose-a-split threshold; 338 is between.
The length is almost entirely three hand-written `RootJsonFormat`s whose per-key `match` arms are
what make C8's strictness and its error messages explicit — the exact opposite of incidental
bloat, and splitting the three co-dependent types across files would hurt cohesion. The executor
flagged rather than splitting unilaterally, which is the right call. Not a change request.

**Design standard (`DESIGN.md`) [mechanical] rules on the one UI touch:** PASS. No inline
`style={{}}`, no hardcoded hex/rgb, **no new CSS at all** — the placeholder reuses the existing
`.panel-content panel-content--state` + `.panel-content__state-label` recipe that five sibling
states in this same file already use (confirmed present at the base commit), and `role="status"`
matches the sibling "Not run yet" state verbatim. On §7's "Empty: render `EmptyState`": I am
**not** raising this. `EmptyState` is the recipe for data-backed *views*; in-panel content states
in `PanelContent.tsx` have their own established shared recipe, and matching the five siblings is
the correct consistency call here. Subjective visual judgment is the skeptic's.

**Issues:**
1. Unknown **top-level** form-config keys are silently dropped (CR3) — contradicts the shipped
   JSON schema and C8's stated rationale.
2. Mutation transcripts promised by tasks 4.7/4.8/4.10 are recorded nowhere (CR4).

---

### Phase 3: UI Review — PASS

Triggered (`frontend/**` and `schemas/**` changed). Servers started via the canonical
`start-servers.sh` (never a bare `npm`/`vite`/`sbt`, per CON-165);
`assert-phase.sh servers` → **PASS servers**. `location.href` re-checked before every reading
(parallel-Playwright hazard).

- **Happy path / real-app render — the D10/C10 confirmation.** A `form` panel created via the API
  renders on the running dashboard as `status` with computed accessible name **"Form not
  configured"**, class `panel-content panel-content--state`, and kind badge `form`. Per HEL-1005 I
  asserted the **computed accessibility name** from the a11y tree, not DOM presence — the
  Playwright snapshot shows `- status [ref=f2e691]: - generic: Form not configured`.
  `.panel-content--metric` node count: **0**. So the live wrong-render D10 exists to prevent does
  not occur in the real app, independent of the jest test.
- **No console errors:** 3 messages total across the entire session, **0 errors / 0 warnings**
  (all three are React DevTools info notices).
- **Breakpoints** — no horizontal overflow (`scrollWidth == clientWidth`) and placeholder intact
  at every width: 1440 ✓, 1100 ✓, 768 ✓, 375 (the 0-width `xs` band) ✓, metric-node count 0 at all four.
- **Unhappy path:** the "unknown top-level key" panel (CR3's artifact) renders the same neutral
  placeholder rather than a blank panel or an exception — degradation is visible, not silent.
- **Entry points / keyboard:** this change deliberately adds no picker entry point (a form panel
  is API-creatable only — proposal.md Non-goals), so there is no new interactive element to
  keyboard-test. The placeholder is correctly non-interactive and not focusable. Panel chrome
  around it (actions/move buttons) retains its accessible names.

---

### Overall: FAIL

Cycle 1 of 3. The implementation itself is strong: **both AC halves are behaviourally verified**,
every gate is green on my own fresh run, and all three mutation claims are genuinely failable
exactly as documented (including C7's subtle 4.3a-stays-green nuance). One real code defect (CR3)
and three artifact/constraint defects (CR1, CR2, CR4) block a pass. All four are cheap and
localized; none requires re-architecting anything.

### Change Requests

1. **Amend proposal.md's Impact list (C12 — binding).** It is wrong in both directions, and the
   final gate diffs `files-modified.md` against it.
   - ADD to the Backend list: `api/ApiRoutes.scala` (wires `dataSourceRepo` into `panelService`,
     without which D6's check silently no-ops), `services/panels/PanelService.scala`
     (`rejectMissingDataSource`, task 1.10), and
     `infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala` (the `FormCreate`
     arm AC2 depends on — mutation-proven load-bearing).
   - ADD a test-support line naming `frontend/src/test/panelFixtures.ts`,
     `frontend/src/features/panels/ui/PanelContent.test.tsx`,
     `frontend/src/features/panels/ui/grid/mobilePanelHeights.test.ts`, and
     `backend/src/test/scala/com/helio/api/routes/proposals/ApplyProposalSpecBase.scala`.
   - REMOVE or qualify `domain/panels/package.scala`: it is listed in Impact but was **never
     touched** (task 1.3 was conditional — "if the config's format derivation needs it" — and it
     did not, since `FormPanel.scala` hand-writes its formats). Mark it "not needed" rather than
     leaving a phantom entry.

2. **Correct design.md's Context (and record the decision).** It currently states the snapshot
   wire is generic so "export/import needs no per-kind wire work". That is true of
   `DashboardSnapshotPanelEntry.fromDomain` (export) but **false of the import side**:
   `DashboardSnapshotRepository.scala:178-185` reconstructs panels through a match on
   `PanelConfigCodec.CreateConfig` that required a `FormCreate` arm, and without it a dashboard
   import containing a form panel would throw `MatchError`. Amend the sentence to scope the
   genericity claim to the export direction, and add the import-side arm as an explicit decision
   (C9's "recorded in an artifact, never merely asserted") so the next kind's author does not
   inherit the same false premise. Evidence that it is load-bearing: mutation 4.7 turns task 4.4's
   export/import test RED.

3. **Close (or explicitly decide) the top-level config silent drop — C8 family.**
   `FormPanelConfig.format.read` (`backend/.../domain/panels/FormPanel.scala:200-218`) validates
   unknown keys on its two *children* (`FormFieldSpec.read:66-68` and `FormSubmitSpec.read:145-147`
   both reject) but performs **no unknown-key check itself**. Measured live:

   ```
   POST /api/panels {"type":"form","config":{"dataSourceId":"…","fields":[],
                     "submitt":{"writeMode":"append"},"bogusTopLevel":123}}
   → http=201   stored config = {"dataSourceId":"…","fields":[],"submit":{"writeMode":"append"}}
   ```

   A typo'd `submitt` silently discards the author's submit `label`/`resetOnSuccess` and the panel
   is created as if they were never sent — the same silent-degradation family C8 exists to close,
   and `schemas/panels/panel.schema.json`'s `$defs.FormConfig` declares
   `"additionalProperties": false`, so backend and published contract now disagree.
   Preferred fix: add an `AllowedKeys` check to `FormPanelConfig`'s `read` mirroring its two
   children (`Set("dataSourceId","fields","submit")`), which routes to 400 through the existing
   `PanelConfigCodec.safe` on the write path while `PanelRowMapper`'s tolerant wrapper keeps the
   read path safe — note D9 layer (iii) already catches this, so **stored** rows stay readable and
   this cannot become a 500-on-read. Add a test for the rejection, and a tolerant-read test for a
   stored config carrying an unknown top-level key. If instead this leniency is deliberate, say so
   in the capability spec and relax the schema's `additionalProperties` — but do not leave the two
   disagreeing.

4. **Record the mutation transcripts (C2 — binding).** Tasks 4.7, 4.8 and 4.10 each say "record
   the transcript" and are all marked `[x]`, but no transcript exists anywhere:
   `.concertino/runs/HEL-1083/evidence/` does not exist, and `files-modified.md` is a file list
   that only *mentions* the mutations in prose. C2 requires the mutation be **recorded**, and the
   Iron Law (`verification-before-completion`) requires the evidence artifact to be real. I
   re-derived all three myself and they are genuine — so this is a missing-artifact defect, not a
   false claim — but the next reader cannot verify them from the repo. Persist the three
   transcripts (command, per-test red/green, the C7 note on why 4.3a stays green) into the change
   dir or the run's evidence dir, and cite them from `files-modified.md`.

### Non-blocking Suggestions

- `FormSubmitSpec.read` accepts `"submit": null` as `Default` (`FormPanel.scala:165`) while a
  non-object like `"submit": 5` is rejected. Harmless today, but it means an explicit null
  silently becomes `append` rather than a validation error; consider treating it like any other
  non-object for consistency with the strictness elsewhere in the file.
- `FormPanelConfig.decodeCreate` is currently `= decode` verbatim (`:223`) with a test asserting
  the equality. That is fine and intentional per D9, but a one-line comment at the definition
  saying *why* it exists as a distinct name (so the write path has a stable seam if create-only
  rules are added later) would save a future reader the trip to design.md.
- The frontend `FormFieldSpec.initialValue`/`options` are typed `unknown`, which is the right
  conservative choice, but `options` is documented "Required when `control` is `select`" in both
  the schema and the TS comment while nothing in the frontend types encodes that. Purely a
  future-ticket note (HEL-1084 owns the builder) — not actionable here.

### Environmental notes (recorded, not defects)

- **RLS could not be validated locally, and I am not implying it was.** Dev and CI run as
  superuser (BYPASSRLS), so V108's `NO FORCE`/`FORCE ROW LEVEL SECURITY` bracketing is
  syntactically applied but its RLS semantics are **not exercised** by any check I ran. Per
  design.md D2 the migration is pure DDL adding no policy and no table, so the residual risk is
  low — but it is unverified locally, by construction.
- **Correction to a brief premise (measured, self-authenticating).** The brief states V108 "is now
  applied to the shared dev DB and visible to other lanes". At the time I probed it, it was
  **not**: `flyway_schema_history` had no version 108, `panels.form_config` did not exist, and
  `panels_kind_check` was still the old 5-value predicate *including* `kind IS NULL OR`. V108 was
  applied only when the backend I started for Phase 3 booted — `installed_on =
  2026-09-17 13:20:06`, after my probe. The brief's *DDL content* claim is now confirmed exactly
  (6-value CHECK, no `kind IS NULL OR`, `form_config JSONB` nullable, one migration). Backend
  tests never touched the shared DB at all — they use zonky EmbeddedPostgres on a per-run random
  port, so the shared-DB state was never load-bearing for the suite.
- Backend test DB is embedded/ephemeral, so the "all worktrees share one Postgres" Flyway
  collision hazard did not apply to the gate runs.
- My Phase-3 probe left test data in the shared dev DB under the intentionally-shared dev account:
  dashboards `1ad45b0d-6c33-4314-a91f-8d7b14710317` and `56c55eb0-f65a-4fdd-a565-8214040e275b`
  (the import target) plus three panels. Disclosed rather than deleted — deletion in a shared DB
  is a destructive pattern-matched op I won't perform unasked.
- The throwaway mutation worktree was removed on completion; `git worktree list` shows no
  scratchpad stragglers, and the delivery worktree is still clean at HEAD `b9dc1553`.
