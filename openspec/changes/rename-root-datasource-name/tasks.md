## 1. Establish the baseline

- [x] 1.1 Run `grep -rn "sourceDataSourceName" backend/src schemas helio-mcp/src frontend/src` and record
      the hit set, separating per-root-shape hits (in scope) from `PipelineSummary` list-scalar hits
      (out of scope per design D4/the ticket's exclusion list).
- [x] 1.2 Confirm `frontend/src` has zero hits before changing anything (the ticket's "no frontend change
      required" premise).

## 2. Backend rename

- [x] 2.1 Rename `RootSourceSchemaResponse.sourceDataSourceName` to `dataSourceName` in
      `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala`.
- [x] 2.2 Verify the spray-json format for `RootSourceSchemaResponse` (a `jsonFormatN`) picks the new
      name up; if any explicit field-name string exists, update it.
- [x] 2.3 Update every construction site of `RootSourceSchemaResponse` in `backend/src/main`.
- [x] 2.4 Correct any scaladoc that describes the *current* field's spelling (design D5); leave comments
      that accurately narrate the *retired singular scalar* as-is.
- [x] 2.5 `cd backend && sbt compile` clean.

## 3. Backend tests

- [x] 3.1 Update the four assertions in `PipelineAnalyzeProposalRoutesSpec.scala` (:185, :255, :302, :452).
- [x] 3.2 Add the AC7 wire-level assertion, preferably in `PipelineAnalyzeRoutesSpec.scala` (the spec for
      the analyze endpoint itself). Parse the response body to a `JsObject` and assert, on a
      `sourceSchemas` entry: its field-key set contains `dataSourceName`; its field-key set does NOT
      contain `sourceDataSourceName`; the `dataSourceName` value is a non-empty `JsString`. Do NOT use
      substring containment on the raw body — `dataSourceName` is a substring of `sourceDataSourceName`,
      so `include("dataSourceName")` passes against the pre-rename wire and proves nothing (design D3).
      Do not rely solely on `entityAs[PipelineAnalyzeResponse]`.
- [x] 3.3 Demonstrate the new assertion is real: confirm it fails when pointed at the pre-rename spelling
      before leaving it green. Paste the observed failure output into the commit/handoff notes — an
      assertion never seen to fail is not yet evidence.
- [x] 3.4 `cd backend && sbt test` green.

## 4. JSON Schemas

- [x] 4.1 Rename the property and its `required` entry in
      `schemas/pipelines/pipeline-analyze-response.schema.json`.
- [x] 4.2 Same in `schemas/pipelines/pipeline-analyze-proposal-response.schema.json`.
- [x] 4.3 `npm run check:schemas` passes. **Do not treat this as proof the rename landed.** Per design
      D-Risks, the gate matches schemas by `title` and diffs top-level `properties` only; the renamed
      field is in an untitled nested `$defs.RootSourceSchema` and in a `required` array, neither of which
      the gate inspects — it exits green even if both schema files are left un-renamed.
- [x] 4.4 **Direct manual verification of the schema edits** (this replaces the coverage 4.3 does not
      provide): for EACH of the two files, print the `$defs.RootSourceSchema` block and confirm by eye
      that (a) the `properties` key is `dataSourceName`, and (b) the `required` array lists
      `dataSourceName` and no longer lists `sourceDataSourceName`. Record both blocks in the handoff.

## 5. helio-mcp

- [x] 5.1 Rename `RootSourceSchemaResponse.sourceDataSourceName` to `dataSourceName` in `helio-mcp/src/types.ts`;
      correct any comment that describes the *current* field per D5. Leave `types.ts:277`/`:503`,
      `context.ts:321` and `runPipelineTruncation.test.ts:23` intact where they narrate the *retired
      singular scalar* — they are AC8's enumerated permitted residue, not defects to erase.
- [x] 5.2 Update `helio-mcp/src/context.test.ts` (:135, :501) and
      `helio-mcp/src/tools/pipelineProposalHandlers.test.ts` (:119).
- [x] 5.3 helio-mcp typecheck and tests green.

## 6. Spec

- [x] 6.1 Update the per-root source-schema requirement in `openspec/specs/pipeline-analyze-api/spec.md`
      (`:116`) to name `dataSourceName` (the change's spec delta is the source of truth for the archive
      step). Leave `spec.md:50` alone — its `sourceDataSourceName` names the retired singular scalar, is
      pre-existing stale text from HEL-913, and is explicitly out of scope per AC3's scope clarification.

## 7. Verification

- [x] 7.1 AC8: run `grep -rn "sourceDataSourceName" backend/src/main/scala/com/helio/api/protocols
      schemas/pipelines helio-mcp/src frontend/src` and **classify every remaining hit**. It passes only
      if each residual hit is a comment/description narrating the retired singular scalar (the eight lines
      enumerated in AC8, matched by content since line numbers may shift). Any residual live field
      declaration, wire key, or `required`-array entry is a failure. Paste the classified hit list into
      the handoff. Do not delete comments to force a literal zero.
- [x] 7.2 AC2: no per-root response shape in the pipelines protocols uses the `source`-prefixed spelling.
- [x] 7.3 Full gate sweep: `sbt test`, `npm run check:schemas`, `npm run lint`, `npm run typecheck`,
      `npm test`.
- [x] 7.4 Record in `files-modified.md` that this change is a **breaking wire change** for analyze-response
      consumers, for the PR description.
