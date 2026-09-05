## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **CR1 (static refresh wiring) is addressed.** design.md D4 now states refresh means both
   `finishCsvRefresh` and `applyStaticRefresh`, and names the exact defect if refresh were skipped.
   tasks.md 2.3 explicitly wires the task 2.1 helper into `DataSourceService.applyStaticRefresh`.
   Read the current file: `applyStaticRefresh` starts at
   `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala:611` (line number
   matches design.md/tasks.md exactly) and its body (611-638) still projects
   `DataFieldType.validateAndCanonicalize(col.\`type\`).getOrElse(col.\`type\`)` straight from
   `payload.columns` — i.e. task 2.3 correctly targets a real, currently-unfixed defect, not an
   already-fixed one. The spec delta adds "Refreshing a static source also reports the materialized
   type" as its own scenario, matching AC5's "corrected on next refresh" for both source kinds.

2. **CR2 (drop `toSchemaFields` as a CSV guard site) is addressed and independently confirmed.**
   design.md D3 now says the guard belongs "in exactly ONE place," `DataSourceService.createCsv`'s
   inline override block, and explicitly rules out `toSchemaFields`. I grepped every call site of
   `toSchemaFields` in the current tree: `SchemaInferenceFacade.scala:22` (definition),
   `SourceService.scala:363`, and `CreateSourceEnvelope.scala:48` — both callers are on the generic
   `ConnectorDriver` (REST/SQL/JSON) path, confirming it is not a CSV site and has no source-kind
   parameter. `PipelineService.scala` has its own private `toSchemaFields` (a different function,
   unrelated) — not a collision with D3's claim. tasks.md adds a new task 3.1a instructing the
   implementer NOT to touch `toSchemaFields`, with a verification step (non-string override still
   accepted on REST/SQL) that would catch a regression if 3.1a were skipped. This is a stronger fix
   than merely deleting the wrong claim — it actively guards against the mistake round 1 caught.

3. **CR3 (single real CSV override site) is addressed.** tasks.md 3.1 now names exactly
   `DataSourceService.createCsv`'s inline block at `DataSourceService.scala:187-194`. I read the
   current file: the override-application block (`val ov = overridesMap.get(f.name)` /
   `SchemaField(f.name, ov.map(...).getOrElse(...))`) is at lines 187-194 in the file today (`ov` at
   line 188), matching the cited range. Confirmed `createCsvUrl` (line 225) takes no overrides
   parameter and `DataSourcePreviewRoutes` → `infer` (per design.md's own trace, unchanged since
   round 1) takes none either — there is genuinely one site, as now stated.

4. **Fresh full pass beyond the three CRs.** Re-read proposal.md-equivalent context via
   design.md/ticket.md, tasks.md groups 1-7, and the full spec delta
   (`specs/schema-inference/spec.md`).
   - Every AC in ticket.md traces to a concrete task/spec scenario: AC1 (decision stated) → D1-D5
     rationale; AC2 (CSV+static invariant) → tasks 1.1-1.3, 2.1-2.3, spec scenarios "Declared type
     matches..." and "Declared integer with numeric cells reports float"; AC3 (JSON/REST/SQL
     divergence documented) → D5 + the new "Declared-vs-runtime type divergence" spec requirement;
     AC4 (blast-radius report) → task 7.2; AC5 (no runtime value moves, 17 conditions unaffected by
     construction) → task 6.5's filter no-change proof; AC6 (existing rows corrected on refresh, no
     migration) → D4 + tasks 2.2/2.3, no Flyway file touched anywhere in tasks.md; AC7 (runtime-type
     measurement, not error-free inference) → group 6's `isInstanceOf`/runtime-class assertions;
     AC8 (sort regression guard for numeric-looking strings) → task 6.4. No AC is left uncovered.
   - No placeholders/TBDs/deferred decisions found in design.md or tasks.md.
   - No internal contradiction between proposal-level intent (ticket.md's approved Option 2) and
     design.md's decisions — D1/D2 both explicitly reject the "cast at load time" alternative for
     the same reason the ticket's rationale gives (no runtime value movement, HEL-889 protection).
   - No sibling-owned files touched: grepped tasks.md/design.md for `RestApiConnectorDriver`,
     `RestSourceConnectorMigration`, `queryParams`, `LocalFileSystem` — none present. No Flyway
     migration task anywhere in tasks.md.
   - Scope check: task 6.6 correctly scopes the CSV-Output-re-inference risk as "record the finding
     for a follow-up ticket rather than fixing it here" — matches ticket.md's "Out of scope" section
     verbatim in spirit, no scope drift.
   - Task 3.1a is new since round 1 and is not scope creep — it operationalizes CR2's warning as an
     enforceable step (a negative-space task with its own verification), which is exactly what a
     careful implementer needs given round 1 found this exact confusion in the design text.

### Verdict: CONFIRM

### Non-blocking notes

- design.md D4's wording is now precise and the line-range citations (`DataSourceService.scala:611-638`
  for `applyStaticRefresh`, `:187-194` for `createCsv`'s override block) both verified byte-accurate
  against the current file — a nice discipline that makes tasks.md unambiguous to implement against.
- Task 3.1a's structure (a "do NOT" task with its own verification) is a good pattern for closing a
  design mistake that a previous review caught; worth keeping in mind for future rounds when a
  skeptic finds a similarly easy-to-misapply guard-site claim.
