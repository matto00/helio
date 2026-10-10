## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD a703ac5648115397afdb34cc086e14a356c1d160 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

1. **The drift is real (orchestrator point 1).** I read both schema files directly.
   `pipeline-analyze-proposal-response.schema.json` `$defs.AnalyzeProposalStep.properties.type` is
   `{"type":"string","minLength":1}`. `pipeline-analyze-response.schema.json` `$defs.AnalyzeStep.properties.type`
   is `{"type":"string"}`. The other differences are `config` (`additionalProperties: true` vs absent, which
   means the same thing in 2020-12) and the descriptions. `AnalyzeWarning`, `RootSourceSchema` and `SchemaField`
   match exactly.
   **Tightening the canonical side is right.** `PipelineAnalyzeProtocol.scala:369-400`:
   `analyzeStepResponseFormat.write` emits `"type" -> JsString(s.type)` for a sealed set of
   `*AnalyzeStepResponse` subtypes. `read` matches only on the `PipelineStepKind.*` constants. Under that
   design an empty kind can't occur, so `minLength: 1` describes the wire as it already is. Task 1.1 still
   has to cite the exact place where each subtype's `type` gets its value.

2. **networknt 1.0.87 supports offline mapping (point 2).** I ran `javap` on the 1.0.87 jar and read the
   source jar, without changing anything:
   - `JsonSchemaFactory$Builder` has `addUriTranslator(URITranslator)` and `addUriMappings(Map)`.
     `builder(JsonSchemaFactory blueprint)` copies the blueprint's translators (JsonSchemaFactory.java:305-314).
   - `URITranslator.prefix(String, String)` exists and returns a `PrefixReplacer` (URITranslator.java:70).
   - `URLFactory`/`URLFetcher` support the `file` scheme (`http, https, ftp, file, jar`).
   - `RefValidator.getRefSchema` sends a non-`#` ref through
     `validationContext.getJsonSchemaFactory().getSchema(schemaUri, config)`. At JsonSchemaFactory.java:404 that
     call applies `config.getUriTranslator().with(getUriTranslator())`, which includes the factory's translator.
     So an absolute `https://helio.local/schemas/...` ref gets translated to the mapped `file:` URI before
     it is fetched. D1's plan is feasible.
   - If a ref can't be resolved, `RefValidator` throws `JsonSchemaException("Reference ... cannot be
     resolved")` at construction (RefValidator.java ~44-51). It does not quietly fall back to `{}`.

3. **The guard in D5 can fail and is not vacuous (point 3).**
   - (a) Comparing the two `$defs` key sets can fail. A mutation that re-adds any same-named def to the
     proposal schema turns it red.
   - (c) The four negative cases and one positive case each depend on a constraint that will exist only in the
     response file after the change: the unknown warning `code` hits the enum, the missing `outputSchema`
     hits `required`, `"type": ""` hits the new `minLength`, and the unknown `SchemaField.type` hits the enum.
     If any `$ref` were replaced with `{}`, (c) would go red. C1 already requires a recorded mutation for
     each part.
   - There is a gap; see non-blocking note 1.

4. **No consumers were missed (point 4).** I ran `git grep` for both filenames across the repo, excluding
   archives. The only code consumers are the backend specs listed in design.md:
   `PipelineAnalyzeRoutesSpec:705,723`, `PipelineAnalyzeProposalRoutesSpec:683`,
   `PipelineAnalyzeSchemaWarningsSpec:222,243` and `PipelineAnalyzeCanRunRoutesSpec:104`. Beyond those:
   - `openspec/specs/pipeline-analyze-api/spec.md:31` refers to the *response* file, which keeps its path
     and `$defs` names. No OpenAPI bundler or validator runs over it.
   - The only ajv consumer is `frontend/src/features/adminUsage/adminUsage.contract.test.ts`, which does
     not touch these files.
   - helio-mcp has no reader of these files.
   - `scripts/check-schema-drift.mjs` (lines 127-166) compares only the top-level `properties` keys against
     the case class named by `title`. The proposal schema's top-level keys don't change. Its `$ref`-following
     part (around line 418) only covers the AssistantProposalToolSchemas parity check, which follows refs
     within the same file.
   - The repo already uses cross-file `https://helio.local/schemas/...` refs (`dashboards/dashboard*.schema.json`),
     so Node tooling already handles them.
   - `WorkspaceContextServiceSpec` goes through the same harness (`compile("workspace/workspace-context...")`),
     so the full `sbt testFull` in task 2.3 is the right breadth check.

5. **"Drift impossible" holds only if no copy remains (point 5).** D3 removes all four copies, including
   `AnalyzeProposalStep`, and keeps only `OutputAnalyze`, which exists only in the proposal schema. The
   description prose that justified the copies is rewritten. Once those are gone, proof by construction holds.
   D5(a) and (c) guard against a copy coming back. The driver-note condition is met.

6. **Placeholders, contradictions, scope:** No TBDs. The one choice left open is in D1: compile with
   `getSchema(URI)` or `getSchema(JsonNode)`. That is a bounded choice backed by a probe, and D2's absolute
   refs make it not matter for resolution. Each AC maps to tasks:
   - URI mapping: 1.2
   - replace defs: 1.3, 1.4
   - specs, check:schemas and selftest green: 2.2, 2.3
   - guard: 2.1

   There is no scope drift, and C3 correctly avoids the HEL-1412 file. No contract delta is needed because the
   wire is unchanged.

### Verdict: CONFIRM

### Non-blocking notes

1. **D5(a) won't catch a copy re-added under a new name, which is how the last copy was named.** The
   duplicate was called `AnalyzeProposalStep`, not `AnalyzeStep`, so a key-set comparison would never have
   caught it. A future `ProposalSchemaField` copy that keeps the same constraints passes both (a) and (c).
   Suggestion: also assert that the proposal schema's `properties.sourceSchemas.items.$ref`,
   `properties.steps.items.$ref` and `properties.warnings.items.$ref` exactly equal the absolute
   `https://helio.local/schemas/pipelines/pipeline-analyze-response.schema.json#/$defs/<Name>` strings.
   This takes one line per property and pins the structure that (a) only approximates.
2. Inside the response schema, the fetched `RootSourceSchema`/`AnalyzeStep` defs use `#/$defs/SchemaField`
   refs that resolve within that document. Put the D5(c) unknown-`SchemaField.type` case in both a
   `sourceSchemas[].sourceSchema[]` entry and a `steps[].inputSchema[]` entry. That proves the nested refs
   resolve against the remote document's base and not the proposal file's own `$defs` (where `SchemaField`
   will no longer exist).
3. Build the mapped factory once, as a `private val` in `JsonSchemaValidation`, not per `compile` call. The
   design implies this; the URI schema cache default (`enableUriSchemaCache`) then deduplicates the fetches.
