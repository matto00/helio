## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- **Round-3 fixes are real.** `openspec validate rename-connector-spi-resolve-api --type change` →
  `is valid`. Fresh rehearsal on my own throwaway copy (`cp -r openspec /tmp/hel825-sk4/openspec`,
  `openspec archive ... -y --json`) → `"specsUpdated": true`, `"modified": 22`, `"renamed": 6`,
  no `archive_spec_update_failed`. Matches the summary.
- **assistant-conversation-loop delta is correct and name-only.** Diffed the delta block against
  canonical lines 162-206: identical except `Connector.testConnection` -> `ConnectorDriver.testConnection`
  on the one line; requirement title unchanged; all 6 scenarios present verbatim.
- **tasks.md numbering is internally consistent.** 4.1 (enumeration + rehearsal), 4.2 (real archive),
  4.3 (Purpose edits, after 4.2). Cross-references at lines 88, 91, 92 all point at the new numbers;
  no dangling references to old numbering.
- **Task 5.3's 8-scenario-title exclusion list is accurate** against the 7 pre-existing deltas
  (connector-spi x5, fetch-error-envelope x1, schema-inference-facade x2 — verified by reading the
  `#### Scenario:` title lines in `openspec/specs/`).
- **Independent re-derivation of the affected-capability set — this is where it fails.** The recorded
  pattern (`\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.testConnection\b`) does
  return exactly the 8 planned files. But I ran a broader sweep for *any* `Connector`-prefixed
  identifier form in `openspec/specs/` and found a **9th capability** the pattern still cannot see:
  the `Connector.scala` **file-name** form.

### Verdict: REFUTE

### Change Requests

1. **Add a 9th delta: `openspec/specs/connector-secret-redaction/spec.md`.** It carries three
   old-name references that this change makes stale, because task 1.1 renames the file
   `Connector.scala` -> `ConnectorDriver.scala`:
   - line 109: `### Requirement: Connector.scala documents the redaction contract` (a **requirement
     title** — so this delta needs a RENAMED/MODIFIED header, and will bump the rehearsal's
     `"renamed"` count from 6 to 7, unlike round 3's delta)
   - line 110: ``` `Connector.scala`'s trait-level doc comment SHALL include a `'''Secret
     redaction'''` block ... ```
   - line 118: `- **WHEN** a developer reads `Connector.scala`'s trait-level doc comment`
   This is not hypothetical drift: the referenced doc block is real
   (`backend/src/main/scala/com/helio/domain/connectors/Connector.scala:82` `'''Secret redaction'''`,
   `:91` `trait Connector[Config]`), and after 1.1 the spec would name a file that no longer exists —
   precisely the AC-4 / HEL-804 drift the ticket forbids. Note line 118 is a **scenario body**, not a
   title, so decision 5a's "titles stay" carve-out does not exempt it.

2. **Widen the recorded grep pattern again — everywhere it is cited** (ticket.md, design.md,
   proposal.md's Modified-Capabilities note, tasks.md 4.1, tasks.md 5.3's old-name list) to also catch
   the file-name/bare-trait form, e.g. add a `\bConnector\.scala\b` leg (or better, a form that
   catches bare `` `Connector` `` references generally, then hand-filter the
   `ConnectorRegistry`/`ConnectorMetadata`/`ConnectorFieldDescriptor` false positives). Two
   successive rounds have now been lost to a pattern that enumerates only the forms someone happened
   to think of; the pattern should be over-broad-plus-filter, not under-broad.

3. **Update every "eight"/"8 total" count to nine** in `proposal.md` (Modified Capabilities +
   Impact), `design.md` (Non-Goals, decisions 5a/6), `ticket.md` (the enumeration — currently "Six
   further ... capabilities ... (8 capabilities total)"), and `tasks.md` 4.1's capability list.

4. **Re-check task 4.3's Purpose-edit list against the 9th capability.** I read
   `connector-secret-redaction`'s `## Purpose` (lines 3-6) and it carries no old identifier, so it
   needs **no** Purpose edit — state that explicitly in 4.3 alongside the other three
   no-Purpose-edit capabilities, so the next reviewer does not have to re-derive it.

5. **Re-run the archive rehearsal after adding the 9th delta** and record the new totals in the
   artifacts (expect `"modified"` to rise from 22 and `"renamed"` from 6 to 7). The currently
   recorded numbers become stale the moment CR 1 lands.

### Non-blocking notes

- I checked the other `Connector`-mentioning specs that are *not* in scope and confirm they are
  correctly excluded: `pipeline-shape-registry:59` names `ConnectorRegistrySpec` (registry names
  deliberately unchanged, decision 3); `csv-upload-connector`, `sql-database-connector`,
  `static-data-connector`, `text-file-connector`, `pdf-connector`, `image-file-connector`,
  `error-response-safety`, `schema-inference`, `pipeline-proposal-apply`,
  `type-registry-content-fields`, `timeline-panel-rendering`, `production-deployment-docs` all use
  "connector" as a lowercase English noun (or an unrelated GCP VPC connector) — no rename needed.
  With CR 1 the set is complete at nine as far as I can find.
- Behavior-preservation is intact: every delta I read is name-only, and no requirement semantics,
  method signature, or response shape is altered anywhere in the change dir.
