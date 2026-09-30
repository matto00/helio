## Evaluation Report — Cycle 1 (evaluation-1.md)
Reviewed HEAD 8c6237e21c262a61b9493566e006a5de7642d16c against base f0df87c9.

### Phase 1: Spec Review — FAIL
Issues:
- nodePath semantics: steps carry no name (PipelineStep has only `kind`), so the implementation returns step KINDS (ProvenanceService.scala:~117, schema description says "Step kinds"). This is the only possible reading of the ticket's "step names" and is acceptable, BUT the planning artifacts still say "step names": proposal.md:14, design.md:34 ("step-name chain"), specs/output-provenance/spec.md:7 ("step names from the root") and :38 ("node path names"). Artifacts do not reflect the final behavior (checklist item). Not an escalation: no alternative exists.
- Everything else matches: AC (a)/(b)/(c) each have tests; public allowlist field-by-field; HEL-1197 ownerId dropped from public panel list (anonymous only, authenticated viewer keeps it per D8) and output-meta; HEL-1177 doc/spec corrected; MCP decision = new tool; row count (own node snapshot count(*)) and query bound (<=8 reads incl. Output) stated in design D3/D6; constraints C1-C5 honored (no migration, OutputService/OutputRoutes untouched, scripts/concertino untouched).
- Minor nuance (non-blocking): rowCount lives inside lastRun, so a materialized snapshot with a never-run pipeline yields lastRun null; zero-row snapshot -> rowCount null (same as "no snapshot"). Consistent with spec/design D3.

### Phase 2: Code Review — FAIL
Gates (run fresh in WORKTREE_PATH):
- `cd backend && sbt test`: 4975 succeeded, 0 failed.
- `npm run lint` clean; `npm run format:check` clean; `npm test` (helio-mcp 307 + frontend 4007) all pass, no flakes seen (HEL-1215 PanelCard did not fire); `npm --prefix frontend run build` ok; helio-mcp typecheck ok.
- check:scala-quality, check:schemas, check:openspec, check:spec-structure, check:node-root-encoding, check:no-credential-leak: clean.
Issues:
- CONTRIBUTING.md "Imports & Qualifiers" (no inline FQNs; check:scala-quality does not catch java./scala. prefixes): ProvenanceService.scala:118 `@scala.annotation.tailrec`; ProvenanceRoutesSpec.scala:105 `java.time.Instant.parse`; ProvenanceServiceSpec.scala:205 `java.time.Instant.now()`. Add top-of-file imports.
Positive: public type is structurally id-free and built field by field; findNameKindsInternal projects only id/name/source_type (no config read); latestNonDryRun is LIMIT 1; explicit-null writers without global NullOptions.

### Phase 3: UI Review — N/A-ish (PASS)
No UI component changed (frontend change is only the public wire type dropping ownerId + test; frontend dashboards tests 141/141 pass). Servers started via start-servers.sh; assert-phase servers PASS. Live probes against THIS worktree's backend (:9545, route distinguishes `{"message":"Output not found"}` from generic route 404, so it serves the new route):
- Auth GET /api/outputs/:id/provenance: 200 for step-bound (nodePath ["aggregate"], rowCount 5), root-bound (nodePath [], rootBound true, rowCount 250); unknown id 404 "Output not found"; no cookie 401 "Unauthorized". These match the MCP tool copy (200/404/401).
- Public route: valid panel on owner's dashboard 200 with only allowlist keys (pipeline.name, sources[name,kind], nodePath, lastRun, assertions{defined,passed,failed,warned}); nonexistent panel 404 "Panel not found"; another dashboard's panel 404; private dashboard with no token / bogus token 404 "Dashboard not found" (identical to output-meta bogus token). Panel with no output / non-output panel covered by PublicProvenanceRoutesSpec (not re-created live to avoid dev-DB residue). No dev-DB residue created by me (login session only).
Red-first verified independently: on base f0df87c9 `git grep provenance` in backend/src/main finds only an unrelated V41 migration (no route), and PublicOutputMetaResponse/public panel list carried ownerId (OutputProtocol.scala:106 on base); red-evidence.txt is consistent with that.

### Overall: FAIL

### Change Requests
1. Update planning artifacts to say step KINDS (steps have no name): proposal.md:14, design.md:34, specs/output-provenance/spec.md:7 and :38 (and any spec delta restating "step names").
2. Replace inline FQNs with imports: ProvenanceService.scala:118 (`scala.annotation.tailrec`), ProvenanceRoutesSpec.scala:105 and ProvenanceServiceSpec.scala:205 (`java.time.Instant`).

### Non-blocking Suggestions
- Consider extending check-scala-quality to flag inline `java.`/`scala.` FQNs (separate ticket).
- Public pipelineName falls back to "" if the pipeline row is missing; acceptable but a test pinning it would be cheap.
