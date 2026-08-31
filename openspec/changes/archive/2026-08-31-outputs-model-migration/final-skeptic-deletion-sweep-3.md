## Skeptic Report — final gate (round 3, axis: deletion-sweep completeness)

HEAD verified: `7c6597b1`. Human-authorized extra round. Every command below re-run fresh in the
worktree; no conclusion inherited from the executor's report or from rounds 1-2.

### What I verified (with evidence)

**1. Round-2 CR2 (`schemas/patch-sets/` `"dataType"` enum) — FULLY FIXED, no third file.**
- `grep -rn '"dataType"' schemas/` returns hits ONLY in `schemas/pipelines/pipeline-shape-catalog.schema.json`
  and `schemas/workspace/workspace-context.schema.json`, where `dataType` is a *column-type* property
  name, entirely unrelated. Zero hits under `schemas/patch-sets/`.
- `grep -n enum schemas/patch-sets/*.json`: `patch-set-preview-response.schema.json:30` and
  `patch-set.schema.json:68` both now read `["panel","dashboard","dataSource","pipeline","pipelineStep"]`.
  Matches `PatchSetProtocol.scala`'s `recognizedKinds` exactly (read at source, lines 62-64).
- The executor's self-reported SECOND file is real and correctly fixed: `patch-set-apply-response.schema.json:29`
  now says "five-way oneOf", lists `PanelResponse/DashboardResponse/DataSourceResponse/PipelineSummaryResponse/PipelineStepResponse`,
  its delete-rollback list is `dashboard/dataSource/pipeline` (no `dataType`), and it carries an explicit
  "HEL-904 removed the `dataType` target kind outright" history note. `patch-set-preview-response.schema.json:20`
  matches. **CR2 closed across all three files.** This finding is fully resolved.

**2. AC 6.1 grep, run verbatim and fresh.** After excluding `db/migration/**`, the
`hel904-real-dump.sql` fixture, comment lines and `src/test`, exactly **15 code hits in 6 files**
remain, all Exemption-1/Exemption-2 wire-field NAMES: `PipelineProposalProtocol.scala:117`,
`WorkspaceContextProtocol.scala:56,58,126`, `PipelineProposalService.scala:325,416,446`,
`CombinedProposalService.scala:82,163,165,167`, `WorkspaceContextService.scala:357,878,880,888`
(plus one harmless history sentence in `services/panels/README.md`). Identical to round 2's set.
**Nothing unexempted survives. AC 6.1 holds.**

**3. `openspec validate outputs-model-migration --type change --strict` → `Change 'outputs-model-migration' is valid`.**
All deltas, including the 11 edited this round, validate cleanly.

**4. Compile + full suite, fresh single-threaded clean run (HEL-924 protocol).**
`sbt -batch 'set Test/parallelExecution := false' clean compile Test/compile test` →
`Total number of tests run: 3348`, `Tests: succeeded 3348, failed 0`, `EXIT=0`. Confirms the
executor's claim independently (3348, up from round 2's 3345 — the +3 are this cycle's new
`V94OutputsMigrationSpec` ruling-proof tests).

**5. Trunk/tail ruling — internally consistent (secondary check, not my axis).**
`design.md`'s new "Decision: position renumbering ruling" is self-consistent and, importantly, its
"narrowed constraint" is genuinely propagated rather than merely asserted: `ticket.md` scope item 1
and the corresponding `tasks.md` task both carry the matching narrowing text (verified in the
`b0e75a0e..HEAD` diff). No contradiction with anything else in `design.md` I read.

**6. Phantom-deferral sweep across this cycle's new notes — CLEAN this round.**
Each deferral target grepped, not trusted:
- Schemas' "an `output` target kind is P1.4's (HEL-907) job" → **real**;
  `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:222` assigns P1.4/HEL-907
  "proposal + patch-set schemas and services (both sides)".
- `panel-data-freshness`'s "a future P-ticket may reintroduce it" → open-ended by construction, not
  a citation to a named-but-nonexistent task. Acceptable.
- Cycle-5 progress claims (mutation probe, +6 `V94OutputsMigrationSpec` tests, 3348-test green run)
  → the test-count claim reproduced exactly by my own run.
**No fifth phantom-deferral instance found.** This pattern appears closed.

**7. Round-2 CR1 (31 sed corruptions) — PARTIALLY fixed. See Change Requests 1-3.**
Round 2's literal grep
(`"the pipeline/Output services\|Output/node[A-Z]\|the Output's config\|outputOutput"`) now returns
only 5 hits, all in `metric-crud-api/spec.md`, and I agree with the executor that those 5 are
legitimate prose ("…the metric's format carries into the Output's config.format" — grammatical and
correct), not corruption. So the *grep* is effectively clean.

But the grep was a detector, not the defect. I re-derived the underlying corruption independently
and found the bulk of it survives, plus two of the executor's own flagged judgment calls are wrong.

### Verdict: REFUTE

### Change Requests

1. **The `DataType` → `Output/node` sed artifact survives 116 times across 16 delta files — the
   substantive remainder of round-2 CR1.** Round 2 named this explicitly
   (`specs/workspace-context-assembly/spec.md:6`, "`Output/nodes` as a resource noun"). The executor
   fixed only the instances its grep pattern happened to match (`Output/node` followed by a capital)
   and left every instance followed by a space, `s`, `'s`, or `` ` ``. Reproduce:
   `grep -rn "Output/node" openspec/changes/outputs-model-migration/specs/` → 116 hits.

   `Output/node` is **not** terminology: it occurs **zero** times in
   `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` (the source of truth) and
   **zero** times in the change's own `design.md`. Both consistently use the noun **`Output`**, with
   "node" reserved for a *different* concept (a pipeline-step-tree node). Reading it as an
   alternation, the text is nonsense in exactly the way round 2 described:
   - `specs/workspace-context-assembly/spec.md` — 73 hits, e.g. `:7` "a single JSON snapshot of the
     caller's data sources, Output/nodes, pipelines, and dashboards"; `:250` "A Output/node with no
     run…" (the un-fixed-up article gives the sed away); `:334` "cross-Output/node pairs".
   - `specs/pipeline-analyze-api/spec.md:74-76` — "`Output/node.sourceId`" is not a resolvable
     identifier under either name.
   - `specs/pipeline-proposal-apply/spec.md:61,87` — "companion Output/node".
   - `specs/assistant-conversation-loop/spec.md:6` — "`resourceType == Output/node`", where the
     shipped value is the string `"dataType"` (`design.md:378`, verified live) — so this line is
     both garbled *and* contradicts the value-exemption `design.md` just blessed.
   - Also in `schema-inference` (4), `fetch-error-envelope` (3), `pipeline-assert-fail-policy` (3),
     `pipeline-run-execution` (3), `resource-tagging` (3), and 5 files with 1 each.

   All of these sit under `## MODIFIED Requirements` in files this branch adds outright, i.e. this is
   the authoritative text archived into `openspec/specs/`. Fix: replace with the canonical noun
   `Output` (adjusting articles: "a Output/node" → "an Output"), except where the intended referent
   is genuinely a *pipeline-step-tree node*, in which case say `node`.

2. **`specs/patch-set-preview/spec.md` now asserts `SHALL` requirements against a class this ticket
   deleted and a target kind this ticket removed.** The executor's stated fix was to restore the
   base-spec wording verbatim ("`the pipeline/Output services` → `DataTypeService` … matching the
   base spec verbatim"). That removes the garble but re-publishes assertions that are now false:
   - `:9,11` — preview `SHALL` reject "a dataType-update edit … (mirrors `DataTypeService.applyUpdate`)"
     and "a dataType-delete edit … (mirrors `DataTypeService.delete`'s two conflict checks)".
     `find backend/src -name "DataTypeService*"` returns **nothing** — the class does not exist.
   - `:20`, `:42`, `:48` — three scenarios specifying `preview` behavior for `dataType-delete` edits.
     `dataType` is no longer a recognized `target.kind` (`PatchSetProtocol.scala:63-64`,
     `recognizedKinds = Set("panel","dashboard","dataSource","pipeline","pipelineStep")`, with the
     comment "HEL-904 task 3.3: `dataType` is REMOVED outright"). Such an edit is rejected at parse;
     none of these scenarios can be satisfied or even reached.
   - `:39` — the impact-hint clause keys on "a `panel` `update` that changes `config.dataTypeId`",
     but task 4.1 removed the panel `dataTypeId` binding (`domain/panels/TextPanel.scala:8`,
     `MarkdownPanel.scala:8`, `package.scala:8` all record `dataTypeId`/`metricIdFormat` removed).

   This is exactly the defect round 2 got right for `panel-data-freshness` — where the executor
   correctly converted to `## REMOVED Requirements` because the method and its caller were deleted.
   The same treatment is owed here: the dataType-specific clauses and their three scenarios must be
   removed (or the requirements moved to `## REMOVED Requirements` with a Reason naming task 3.3),
   not restored verbatim. "Matches the base spec" is not the correctness bar when this ticket's whole
   purpose is deleting what the base spec described.

3. **`specs/resource-tagging/spec.md`'s newly-composed `OutputRepository` wording is factually wrong
   on the read side.** The executor flagged this as a judgment call ("no base-spec equivalent existed
   — best available real identifier"). The write half is defensible: `OutputRepository.insertInternal`
   really does take `tag: Option[String] = None` and persist it (`OutputRepository.scala:126-142`,
   `domainToRow` line 44/55). But the scenario at `:18-20`:
   > **WHEN** a tagged data source, pipeline, or Output/node is fetched by id or listed
   > **THEN** the response includes the `tag` value that was set at creation

   is contradicted by the shipped code's own comment at `OutputRepository.scala:84-86`:
   > the domain `Output` case class does not surface a `tag` field (the DB column exists but is not
   > yet read out; left for a later cycle if tag-scoped Output listing is ever needed)

   An Output's `tag` is write-only in the shipped build; it is never returned on any read. Fix: scope
   that scenario to data sources and pipelines, and add an explicit note that `tag` is persisted but
   not yet read back for Outputs (with the deferral, if any, pointed at a real ticket — do not invent
   one).

### Non-blocking notes

- `metric-crud-api/spec.md`'s five identical pasted Migration sentences (round 2's non-blocking note)
  remain; still cosmetic, still not blocking.
- Findings 1-3 are all narrow documentation edits under `openspec/changes/.../specs/`. No backend
  code, schema, or migration change is implied — the shipped code, schemas, migration, AC grep,
  `openspec validate`, and the 3348-test suite are all clean and independently confirmed above.
