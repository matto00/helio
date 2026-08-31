# Evaluation Report — Cycle 1 (evaluation-1.md)

HEAD reviewed: `4c86e658`. All gates re-run fresh by the evaluator; no executor
self-report inherited.

## Phase 1: Spec Review — FAIL

Issues:

1. **(BLOCKING) Design-gate decision 3 was reversed unilaterally.**
   `design.md:66-69` states the verification approach as a settled decision: the
   red-first migration test "runs the real V94 migration against a fixture derived
   from `pg_dump --data-only` of the local dev DB (per acceptance criteria), **not a
   hand-authored SQL fixture** — this is what the executor and the skeptic both use
   as ground truth, **since a hand-authored fixture could miss a real shape the
   migration doesn't yet handle**." The ticket AC says the same thing.
   `V94OutputsMigrationSpec.scala:26-29` does exactly the rejected thing (hand-built
   fixture), and `tasks.md:159-165` marks task 2.11 `[x]` while its own text says
   "(partial) ... not yet a real `pg_dump --data-only` ... a genuine `pg_dump`
   fixture should replace/augment this once 2.9's full data migration exists to test
   against." Task 2.9 has since landed; the replacement never happened.
   This is not a bookkeeping nit — see Phase 2 issue 1, which is precisely the
   "real shape the migration doesn't yet handle" that the decision existed to catch,
   and which the hand-built fixture does in fact miss.

2. **AC not met: RLS smoke test covers only `outputs`, not `node_snapshots`, and
   never proves grantee read.** The ticket AC requires proving "owner read /
   grantee read / other-tenant denial on `outputs` **and** `node_snapshots`". The
   suite is titled `"V94 outputs/node_snapshots RLS (task 2.13)"`
   (`V94OutputsMigrationSpec.scala:399`) but both of its tests query `outputs` only;
   `grep -n "node_snapshots"` inside the RLS block returns nothing, and
   `grep -in "grantee|share|acl_grant"` on the whole spec returns nothing. The
   owner branch and the other-tenant-denial branch of `helio_can_access_pipeline`
   are proven; the **sharing** branch — the specific reason the ticket chose
   sharing-aware RLS mirroring `pipelines` (V39) rather than owner-only
   `pipeline_steps` (V35) — is untested on either table.
   `tasks.md:169-175` marks 2.13 `[x]` while stating "**`node_snapshots`' RLS is not
   yet covered** ... deferred to when real snapshot data exists post-2.9 (currently
   no writer path populates it)". That stated precondition is now satisfied — V94
   section 11 populates `node_snapshots`, and the spec asserts on its rows at
   `:726-746`. The deferral's own reason has expired.
   `RlsPolicyGuardSpec:70-71` registers both tables, but that is a structural
   policy-presence check, not a behavioral proof, and does not discharge this AC.

3. **Two tasks marked `[x]` whose own text says "(partial)", where the unfinished
   part is exactly an acceptance criterion** — 2.11 and 2.13 above. (2.5/2.7/2.8's
   "(partial)" markers are benign: later sections of the same migration complete
   them, and I verified the final state.)

4. **Absorbed-ticket scope silently dropped (non-blocking, but must not be lost).**
   Task 4.6 (split the oversized pipeline service files, absorbing HEL-689) is
   unchecked and was deferred every cycle. I confirm the deferral is *accurately*
   characterized: `check:scala-quality` exits 0 (130 warnings, all soft line-budget
   only; zero hard violations), and nothing functional in this ticket depends on it.
   But ticket.md lists HEL-689 under "Absorbed tickets (substance is AC here)", so
   HEL-689 must be explicitly re-opened / re-filed rather than closed as absorbed.
   See Non-blocking Suggestions.

5. Tasks 0.1/0.2 remain unchecked; both are tasks.md-maintenance items superseded by
   the revision that introduced them. Cosmetic.

Verified clean in this phase:

- Ticket item 7 (`binary_refs` keying): **independently re-verified against the dev
  DB.** `binary_refs` has exactly 1 row and it *does* resolve to a pipeline-output
  type (`join pipelines p on p.output_data_type_id = b.data_type_id` → 1). The
  ticket's conditional ("if any do, key those by `(pipeline_id, node_step_id)`
  instead") therefore fires, and the implementation keys by
  `(pipeline_id, node_step_id)`. Correct, and the fallback branch was taken on real
  evidence, not assumption.
- Ticket item 8 (companion-type computed fields): **independently re-verified.**
  `data_types` with `source_id IS NOT NULL` and non-empty `computed_fields` → **0**.
  The migration's count-first-if-zero-skip is correct, and V94:663-677 documents both
  the zero finding and the latent ordering hazard honestly rather than silently.
  5 pipeline-output types carry computed fields and are migrated by V94:702-745.
- The two wire-field-NAME exemptions (item 7 of the briefing) are **genuinely
  documented**, not merely asserted in an execution log: `design.md:317-370` carries
  a full named decision with justification and blast-radius evidence for both
  `PipelineProposalProtocol` and `WorkspaceContextProtocol`. I also checked that the
  in-code `design.md` citations resolve to real content: `OutputPanel.scala:16`'s
  "Panel remains the name for a placement" resolves to spec line 35, and
  `TextPanel.scala:11`'s "design.md line 76/103" resolves to spec lines 76 and 103.
  The prior defect class is not present here.
- The 115-file OpenSpec partition is **exact**. I re-derived
  `grep -rl "DataType\|Metric" openspec/specs` → exactly 115 files, and confirmed
  every one is named somewhere in `openspec-coverage-checklist.md` (zero unlisted
  survivors, verified by iterating all 115 against the document). 71 delta files
  present in `specs/`. The checklist's own subtotal arithmetic is loose and says so;
  the exact claim it asks to be judged on holds.
- Shared dev DB hygiene: `flyway_schema_history` head is V93 — V94 was **not**
  applied to the shared dev DB. Correct per the ticket's own operational warning.

## Phase 2: Code Review — FAIL

Gates, all re-run fresh by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):

| Gate | Result |
| --- | --- |
| `sbt 'set Test/parallelExecution := false' test` | **PASS** — `Total number of tests run: 3360`; `Suites: completed 225, aborted 0`; `Tests: succeeded 3360, failed 0`; exit 0. Single-threaded per the HEL-924 protocol. This is my own fresh run, not the inherited claim. |
| `check:scala-quality` | PASS — "clean (130 soft warning(s))", exit 0 |
| `check-schema-drift.mjs` | PASS — 84 schema entries, 60 checked across 46 protocol files, 7 panel-type surfaces in sync, exit 0 |
| `check-openspec-hygiene.mjs` | PASS — "openspec/ is clean", exit 0 |
| `openspec validate outputs-model-migration --type change --strict` | PASS — "Change 'outputs-model-migration' is valid" |

Issues:

1. **(BLOCKING — silent, irreversible data corruption of 58 live panels) V94 strands
   every bound panel whose `type_id` does not resolve to a pipeline, then destroys
   the evidence.**

   Three sections of `V94__outputs_model.sql` disagree about what "bound" means, and
   the gap between them is not empty on the real dev DB:

   - **Section 4** (`V94__outputs_model.sql:174-179`) backfills
     `kind = 'output'` for **every** panel with
     `type IN ('metric','chart','table','collection','timeline')`, or
     `type = 'text' AND type_id IS NOT NULL` — with **no** check that `type_id`
     resolves to anything.
   - **Section 9** (`:568`) sets `output_id` only for panels reached through
     `panels → data_types → pipelines ON p.output_data_type_id = dt.id`.
   - **Section 10** (`:621`) deletes only panels with `type_id IS NULL`.

   A panel with a non-NULL `type_id` pointing at a `data_types` row that no pipeline
   claims falls through all three: it is marked `kind = 'output'`, never given an
   `output_id`, and never deleted. Section 17 (`:929`) then does
   `ALTER TABLE panels ALTER COLUMN kind SET NOT NULL` and section 18 drops
   `type`, `type_id`, and `field_mapping` — after which the row is a
   `kind = 'output'` panel with `output_id = NULL` and no surviving record of what it
   was ever bound to. `OutputPanelConfig(outputId: OutputId)` has no representation
   for that state.

   **Measured on the real dev DB (`jdbc:postgresql://localhost:5432/helio`, the exact
   database the AC names as the fixture source):**

   ```
   bound panels total                                      | 113
   bound panels whose type_id resolves to a pipeline       |  55
   bound panels with NO resolvable pipeline (would strand) |  58
   ```

   i.e. **51% of all bound panels**, spread across ~30 distinct dashboards
   (chart 26 / metric 24 / collection 3 / table 3 / text 2), with no soft-delete
   column on `panels` to excuse them as dead rows. Underlying cause: 77 `data_types`
   rows have `source_id IS NULL` and no pipeline pointing at them — neither companion
   types nor live pipeline-output types (pipelines deleted out from under them).

   This directly violates two of the ticket's own migration-test acceptance
   assertions — "panel count = bound + content panels (unbound deleted, count matches
   the log)" and "every `kind = output` panel resolves `output → node → pipeline`" —
   and it is the exact failure mode design.md decision 3 predicted for a hand-authored
   fixture. `V94OutputsMigrationSpec` passes because its fixture contains no such row.

   Note the mirror-image gap in section 13 (`:769-813`): the orphan-type backfill also
   joins through `pipelines`, so these 77 types get no `table` Output either. Whatever
   remedy is chosen must cover both.

   **This does not require reopening the design.** design.md decision 3 already
   mandates the fixture that would have caught it; the ticket's `2.9(c)` "unbound data
   panels are deleted, count logged" is the natural home for the remedy (broaden
   "unbound" from `type_id IS NULL` to "no resolvable Output", with the count logged
   to `hel904_migration_counts` as every other section does). If the executor
   concludes these 58 panels should be *preserved* rather than deleted, that is a
   product call and should be escalated rather than guessed.

2. **(Non-blocking, but a false statement in a shipped file) `OutputPanel.scala:19-27`
   is stale and factually wrong about the code it sits in.** Its second scaladoc
   paragraph reads: "Added additively in this task ... **not yet registered in
   `Panel.Registry`, and the five bound subtypes it replaces are not yet deleted**.
   The full cutover (Registry swap, deleting `MetricPanel`/`ChartPanel`/`TablePanel`/
   `CollectionPanel`/`TimelinePanel`, rewriting `PanelRepository`/`PanelRowMapper`/
   `PanelProtocol`/`PanelService` onto `output_id` ...) is the remainder of task 3.6,
   left for the next increment of this same task." All of that shipped:
   `Panel.scala:92` registers `OutputPanel.Kind -> OutputPanel.companion`, and
   `ls backend/src/main/scala/com/helio/domain/panels/` shows all five bound files
   deleted. A new reader is told the opposite of the truth. This is the confidently-
   false-documentation class HEL-849's comment standard exists to prevent.

3. **(Non-blocking) Five stale/orphaned directory READMEs describing deleted code,
   two of which are literal hits on the ticket's own 6.1 grep.** After the deletions,
   three directories survive containing *only* a README about classes that no longer
   exist:
   - `backend/src/main/scala/com/helio/infrastructure/persistence/metrics/README.md`
     — "Holds: `MetricRepository`." (directory otherwise empty)
   - `backend/src/main/scala/com/helio/services/metrics/README.md`
     — "Holds: `MetricService`." (directory otherwise empty)
   - `backend/src/main/scala/com/helio/api/routes/metrics/README.md`
     — "Holds: `MetricRoutes`." (directory otherwise empty)

   And two live-directory READMEs still advertise deleted classes:
   - `infrastructure/persistence/pipelines/README.md:3,5` — describes "the
     source->pipeline->type chain's storage layer" and lists `DataTypeRepository`,
     `DataTypeRowRepository`; does not mention `OutputRepository` /
     `NodeSnapshotRepository`.
   - `services/pipelines/README.md:3,5` — "and the DataType family (a pipeline's
     output artifact)"; lists `DataTypeService`.

   The first two are why the 6.1 grep is not literally clean (see below).

**6.1 acceptance grep — re-run fresh by me, verbatim.** It returns 319 lines. After
excluding `backend/src/main/resources/db/migration/**`, tests, and comment lines, the
surviving production hits are: the two documented `design.md` exemptions
(`WorkspaceContextProtocol.scala:56,58,126`, `PipelineProposalProtocol.scala:117` and
their `WorkspaceContextService` / `PipelineProposalService` / `CombinedProposalService`
call sites — all wire field NAMES, all `String`-typed, exemption verified genuine) plus
the two stale `metrics/README.md` files in issue 3. The type-level criterion the
briefing singled out is **fully clean**:
`grep -rnE "com\.helio\..*DataType" backend/src --include=*.scala` returns **zero**;
the `WorkspaceContextDataType` residual is genuinely gone. Once issue 3's READMEs are
removed, the grep reduces to migrations + the two named exemptions + comments, which
is the intended end state and should be stated as such in the PR.

**6.2 OpenSpec grep — re-run fresh.** 115 files, all classified, zero unlisted
survivors (see Phase 1). Note for the PR: this grep cannot be *empty* pre-archive,
since the 71 rewrites live in `changes/*/specs/` until `openspec archive` applies
them — that is the intended OpenSpec workflow, not a gap.

**Migration test quality (briefing item 2) — reviewed line by line.** With the single
exception of issue 2 in Phase 1 (`node_snapshots` RLS / grantee), the assertions the
briefing asked me to confirm are all present and real, not DDL-shape theatre:
row-for-row `node_snapshots` equality (`:726-746`), `output → node → pipeline`
resolution (`:548`), exactly-one-tail per aggregation panel (`:564`) and per
metric panel with `metrics.format` carried into `config.format` (`:610`), invalid
`fieldMapping` slot dropped and logged (`:588`), `position` never reset (`:270`,
`:643`), alert rules resolving to the lowest-position Output on the right node
(`:753`, `:768`), unbound-panel deletion with an exact logged count (`:657`).
The RLS mechanism is genuinely non-vacuous: `CREATE ROLE helio_app_test_v94
NOSUPERUSER` driven through `HikariConfig.setConnectionInitSql("SET ROLE ...")`
(`:238-253`), with a real red proof that drops `outputs_select`, asserts access
disappears, restores it, and asserts access returns (`:427-450`). The red-first
strategy (migrate to V93, assert the pre-state genuinely lacks the new shape, then
migrate) is sound. The defect is the *fixture's coverage*, not the assertion style.

## Phase 3: UI Review — N/A

Backend-only row; UI gate explicitly N/A per spec decision 17 and ticket.md. No dev
server started.

## Overall: FAIL

## Change Requests

1. **Fix the stranded-panel data-loss path in `V94__outputs_model.sql`.** Reconcile
   sections 4 (`:174-179`), 9 (`:568`) and 10 (`:598-623`) so that no panel can reach
   section 17's `SET NOT NULL` / section 18's column drops with `kind = 'output'` and
   `output_id IS NULL`. Concretely: broaden step 2.9(c)'s "unbound" predicate from
   `type_id IS NULL` to "has no resolvable Output after section 9" (equivalently:
   `kind = 'output' AND output_id IS NULL` immediately before section 17), delete
   those rows, and log the count into `hel904_migration_counts` under its own key
   alongside `unbound_panels_deleted`. Apply the mirror fix in section 13 for the 77
   `data_types` rows with no owning pipeline. Add a `CHECK (kind <> 'output' OR
   output_id IS NOT NULL)` (or equivalent assertion at the end of the migration) so
   this class of gap fails the migration loudly instead of silently corrupting rows.
   Verified count on the dev DB today: **58 panels across ~30 dashboards**. If the
   correct product behavior is to *preserve* these panels rather than delete them,
   escalate rather than choose.

2. **Replace the hand-built fixture with a `pg_dump --data-only` fixture**, per
   `design.md:66-69` and the ticket AC. The fixture must contain (per the AC's own
   list) every panel kind, ≥1 aggregation panel, ≥1 `metric_id` panel, ≥1 data-bound
   text panel, ≥1 unbound data panel, ≥1 orphan output type, ≥1 companion type, ≥1
   computed field, ≥1 alert rule, ≥1 binary ref, ≥1 invalid `fieldMapping` slot — and,
   as change request 1 proves is necessary, ≥1 bound panel whose `type_id` resolves to
   no pipeline. If a genuine `pg_dump` remains operationally out of reach, that is a
   reversal of a confirmed design decision and must be escalated for an explicit
   ruling, not decided in tasks.md. Un-tick task 2.11 until this lands.

3. **Complete the RLS smoke test to the AC.** Add, in `V94OutputsMigrationSpec`'s RLS
   block: (a) owner read / other-tenant denial on `node_snapshots` (rows now exist —
   the spec already reads them at `:726`), with its own drop-policy red proof; (b) a
   **grantee** read on both `outputs` and `node_snapshots`, seeding a real ACL grant so
   the sharing branch of `helio_can_access_pipeline` is exercised — this is the branch
   that distinguishes the chosen V39-mirroring policy from V35 owner-only, and it is
   currently unproven. Un-tick task 2.13 until this lands, and delete its now-expired
   "no writer path populates it" deferral note.

4. **Delete the three orphaned metrics directories and their READMEs**
   (`infrastructure/persistence/metrics/`, `services/metrics/`, `api/routes/metrics/`
   — each contains only a `README.md` describing a deleted class), and update
   `infrastructure/persistence/pipelines/README.md:3,5` and
   `services/pipelines/README.md:3,5` to drop `DataTypeRepository` /
   `DataTypeRowRepository` / `DataTypeService` and the "source->pipeline->type chain"
   / "DataType family" wording, listing `OutputRepository` and
   `NodeSnapshotRepository` instead. This also removes the last two non-exemption,
   non-migration hits from the 6.1 acceptance grep.

5. **Delete the stale second paragraph of `OutputPanel.scala`'s scaladoc**
   (`:19-27`, "Added additively in this task ... left for the next increment of this
   same task"). Every claim in it is now false. Keep the first paragraph, which is
   accurate and useful.

6. **State the 6.1/6.2 grep end-state honestly in the PR body** rather than as
   "returns nothing": 6.1 returns migration files, comments, and the two `design.md`-
   documented wire-field-NAME exemptions (naming both); 6.2 returns the 50
   named-deferral files plus the 65 whose rewrites are staged in `changes/*/specs/`
   pending `openspec archive`, linking `openspec-coverage-checklist.md`. Also record
   in the PR, per task 6.6: computed-field count = 6 non-empty (5 pipeline-output,
   migrated; 0 companion, skipped-and-logged; 1 on a pipeline-less type — covered by
   change request 1), and `binary_refs` = 1 row which *does* point at a
   pipeline-output type, hence keyed by `(pipeline_id, node_step_id)`.

## Critical Path

Not the final cycle, but recording the ordering explicitly given this ticket's
irreversibility: **change requests 1 and 2 are the only ones that matter for merge
safety, and 2 is what would have found 1.** Do 2 first — build the `pg_dump` fixture,
watch it go red on the 58 stranded panels, then fix 1 and watch it go green. That
sequence turns both into one piece of evidence instead of two assertions. 3 is a real
AC gap but not a corruption risk. 4-6 are hygiene and can ride along.

## Non-blocking Suggestions

- HEL-689 (task 4.6) is listed in ticket.md under "Absorbed tickets (substance is AC
  here)" but is not being delivered. The deferral itself is well-justified — no hard
  `check:scala-quality` violation, no functional dependency, and it is pure refactor
  in the largest diff of the remodel, where a behavior-preserving move is exactly the
  thing worth *not* doing under this much churn. But it must not be closed as
  absorbed: re-open HEL-689, or file its successor, at PR time.
- Task 6.5 (pointer comments on HEL-907/908/909 for the 49 deferred capabilities) is
  correctly deferred to the orchestrator at merge time. Worth actually doing — it is
  the only thing standing between the 50-file deferral list and a silently forgotten
  spec.
- The RLS red-proof test at `:427-450` drops and re-creates `outputs_select` by hand.
  The recreated policy is `FOR SELECT USING (helio_can_access_pipeline(pipeline_id))`,
  which may not be byte-identical to V94's original (e.g. any `AS RESTRICTIVE` /
  `WITH CHECK` nuance), leaving later tests in the suite running against a
  hand-rebuilt policy. Consider asserting the recreated definition against
  `pg_policies`, or scoping the drop to a savepoint/transaction.
- `design.md`'s cycle-29 exemption addendum (`:317-370`) is a genuinely good piece of
  writing — it names the finding, the ruling, the two exemptions, the evidence for
  each, and what was explicitly *not* exempt. Worth keeping as the template for how a
  mid-execution scope ruling gets recorded.
