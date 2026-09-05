## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Ground truth diff.** `git diff main...HEAD` at `21f76c14`: 6 code/contract files
  (`PipelineAnalyzeProtocol.scala`, two backend specs, `helio-mcp/src/types.ts` + 2 mcp tests,
  both `schemas/pipelines/pipeline-analyze-*response.schema.json`, `openspec/specs/pipeline-analyze-api/spec.md`)
  plus change artifacts. No unrelated edits — **no scope drift**.

- **AC1/AC2** — `PipelineAnalyzeProtocol.scala:184-186` now declares `dataSourceName`. No per-root
  protocol shape carries the `source`-prefixed spelling (grep below).

- **AC7 — the substring trap did NOT ship.** `PipelineAnalyzeRoutesSpec.scala:147-170` parses the raw
  body (`responseAs[String].parseJson`), takes the `sourceSchemas` head object's `fields.keySet`, and
  asserts (a) `contain("dataSourceName")`, (b) `should not contain "sourceDataSourceName"`, (c) value is
  a non-empty `JsString`. Exact key-set membership, not substring containment; assertion (b) is what
  makes it red against the pre-rename wire. Confirmed it actually **ran**: sbt log line
  `- should serialize sourceSchemas entries with the renamed dataSourceName wire key`.

- **AC4/AC6 — gates re-run by me, output read.**
  - `sbt -batch "testOnly ...PipelineAnalyzeRoutesSpec ...PipelineAnalyzeProposalRoutesSpec"` →
    `Tests: succeeded 42, failed 0`, exit 0.
  - `npm --prefix helio-mcp run typecheck` → clean.
  - `npx jest helio-mcp/src/context.test.ts helio-mcp/src/tools/pipelineProposalHandlers.test.ts` →
    `2 passed, 29 tests`. (Measurement note: my first attempt ran these under `npx vitest`, which
    failed with `describe is not defined` — a wrong-runner artifact of my own invocation, not a
    defect. Re-run under the repo's actual runner (jest) reproduced green. Reported per the
    reproduce-before-refute rule.)

- **AC5 — not resting on `check:schemas`.** `npm run check:schemas` passes ("74 checked across 48
  protocol files"), but as the design gate warned, that is not proof for this field. Independent
  coupling evidence exists and is exercised: `PipelineAnalyzeRoutesSpec.scala:591-607` builds a
  **populated** `RootSourceSchemaResponse("root-1", "orders-source", ...)`, serializes it, and validates
  against `pipelines/pipeline-analyze-response.schema.json` — whose `required` array now names
  `dataSourceName`. A protocol/schema disagreement would make that test red. Both schema files were
  read in the diff: property renamed **and** `required` entry renamed, in both files.

- **AC8 — classified grep, no manufactured cleanliness.** The scoped grep returns exactly the eight
  enumerated hits, all comment/`description` text narrating the retired singular scalar; zero live
  declarations, wire keys, or `required` entries. I separately checked the diff for comment deletions:
  every `-` line containing `sourceDataSourceName` is a live declaration, test assertion, wire key, or
  `required` entry — **no comment was deleted to force a clean grep**.

- **Consumer sweep, repo-wide.** Full-tree grep (excluding `node_modules`, archived changes,
  `.concertino/runs`): remaining live hits are all `PipelineRepository.PipelineSummary
  .sourceDataSourceName` and its consumers (`WorkspaceSearchService`, `PatchSetPreviewProjection`,
  `scripts/agent/workspace.sh`, `schemas/workspace/workspace-context.schema.json`, the
  `pipeline-list-api`/`pipeline-edit-flow`/`patch-set-apply`/`pipeline-editor-page` specs) — the
  unrelated pipeline-list summary scalar, explicitly and correctly out of scope. `frontend/src` has
  zero hits, confirming the "no frontend consumer" claim at the code level.

- **No UI surface** (backend/contract/mcp only) — servers deliberately not started, per the shared-dev-DB
  constraint. Design-standard review is not applicable to this diff.

### Verdict: REFUTE

One consumer the sweep missed. It is not a wire consumer, so nothing breaks at runtime — but the change
makes an existing frontend comment **actively false about the wire contract this ticket defines**, and
that comment names HEL-975 by number as the place a future reader should look. Shipping it as-is leaves
the repo documenting the wrong wire key at the exact spot the next person will read.

### Change Requests

1. `frontend/src/features/pipelines/types/pipelineStep.ts:469-489` (the `HEL-969:` block above
   `export interface RootSourceSchema`) is now factually wrong. It states the analyze wire sends the field
   "spelled with a `source`-prefix", and that `dataSourceName` (the `PipelineRootSummaryResponse`
   convention) is "a name ... that the wire does not actually use" — after this change the wire uses
   exactly `dataSourceName`. It then says "Aligning the backend's two per-root response shapes onto one
   spelling is tracked separately as HEL-975; the next person who needs this value should look there" —
   i.e. it forward-references *this* ticket for the resolution, so this ticket is where it gets corrected.
   Rewrite the comment to state the current truth: the wire now sends `dataSourceName` (HEL-975), a
   truthful name is available, and the field is still omitted from `RootSourceSchema` only because
   nothing reads it (grep-confirmed zero consumers).

   Note this residue is invisible to AC8: the comment says "a `source`-prefix" rather than the literal
   `sourceDataSourceName`, so the AC8 grep cannot see it. Correcting it is a comment-only edit under
   `frontend/src` and does not disturb AC8's zero-hit requirement.

   Adding the field to `RootSourceSchema` is **not** requested — that would be scope drift with no
   consumer. The comment correction alone is what is required.

### Non-blocking notes

- `openspec/specs/pipeline-analyze-api/spec.md:50` still names `sourceDataSourceName` in the top-level
  requirement paragraph. This is the *retired singular scalar* removed by HEL-913, not the per-root field,
  and the ticket's AC3 explicitly rules it out of scope. Correct to leave — flagging only so a future
  reviewer does not re-open it. It is pre-existing staleness worth a separate cleanup ticket.
- The AC7 test is a genuine guard (it fails by mutation of the wire key), not a tautology. Worth keeping
  as the canonical pattern for future wire-key renames where the new name is a substring of the old.
