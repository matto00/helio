## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed at `c7243b4a` (`git diff main...HEAD`, two commits: `21f76c14` rename, `c7243b4a`
round-1 CR1 fix). Every finding below is derived from the current tree and from gates I ran
myself; the round-1 report, `evaluation-1.md` and `files-modified.md` were read as claims only.

### What I verified (with evidence)

**CR1 — genuinely addressed, and true about the wire.**
Read the rewritten `HEL-969:` block at `frontend/src/features/pipelines/types/pipelineStep.ts`
(lines ~469-489, immediately above `export interface RootSourceSchema`). Every factual claim it
now makes is one I independently confirmed on this tree:
- "HEL-975 has since renamed that backend field to `dataSourceName`" — true:
  `PipelineAnalyzeProtocol.scala:184` declares `dataSourceName: String` inside
  `RootSourceSchemaResponse`.
- "matching the sibling `PipelineRootSummaryResponse.dataSourceName` convention" — true:
  `PipelineProtocol.scala:87` region carries `dataSourceName`.
- "nothing in this codebase reads it today (grep-confirmed zero consumers)" — true:
  `grep -rn "sourceDataSourceName" frontend/src` → 0 hits, and no `RootSourceSchema` consumer
  reads a name field (the interface is `{ rootId, sourceSchema }`).
The two false statements round 1 refuted on ("the wire still sends a `source`-prefix", "no name
both AC3-compliant and truthful") are gone, and where the prefix is mentioned it is correctly
tensed to HEL-969's authoring time ("At the time HEL-969 wrote this..."). The stale
forward-reference telling the reader to go look at HEL-975 is replaced with the concrete
instruction to add `dataSourceName: string`. The comment is now accurate.

**CR1 fix did not reintroduce the literal, so AC8 is undisturbed.**
`grep -rn "sourceDataSourceName" frontend/src` → **0 hits** (re-run; the comment says
"a `source`-prefix" generically, never the identifier).
AC8's own scoped grep (`backend/.../api/protocols`, `schemas/pipelines`, `helio-mcp/src`,
`frontend/src`) → **exactly 8 hits**, matching the ticket's enumerated permitted set one-for-one
by content: `PipelineAnalyzeProtocol.scala:181`, `PipelineProtocol.scala:103`,
`WorkspaceContextProtocol.scala:125`, `pipeline-analyze-response.schema.json:17` (a `description`),
`helio-mcp/src/types.ts:277` and `:503`, `helio-mcp/src/context.ts:321`,
`helio-mcp/src/runPipelineTruncation.test.ts:23`. I read all eight: each narrates the **retired
HEL-913 singular scalar**; none is a live declaration, wire key, or `required` entry. All eight
are intact — `git show --stat c7243b4a` shows commit 2 touches none of those files, so none was
deleted to manufacture a clean grep.
(Measurement note: my first grep widened `schemas/pipelines` to all of `schemas` and returned 9,
the extra being `schemas/workspace/workspace-context.schema.json:351` — outside AC8's stated
scope, and itself a HEL-913 history `description`. Re-run at the AC's actual scope: 8. That was
my scoping error, not a defect.)

**The fix stayed comment-only — verified mechanically, not by reading the message.**
`git show c7243b4a -- frontend/src` filtered to changed lines that are **not** `//` comments
returns **empty output**. The `RootSourceSchema` interface body is byte-identical
(`rootId: string; sourceSchema: SchemaField[]`) — the field was correctly **not** added (that
would have been the scope drift round 1 explicitly disclaimed). Commit 2's full stat is 4 files:
the one comment edit plus three change-dir artifacts (`evaluation-1.md`, `skeptic-final-1.md`,
one `files-modified.md` line). No drift.

**Round-1 findings re-checked on the current tree — all still hold.**
- *AC7*: read `PipelineAnalyzeRoutesSpec.scala:150-170`. It parses the raw body
  (`responseAs[String].parseJson.asJsObject`), takes `sourceSchemas` head `.fields.keySet`, and
  asserts all three halves — `contain("dataSourceName")`, `should not contain
  "sourceDataSourceName"`, and a `JsString(value) => value should not be empty` match. These are
  exact **set-membership** assertions on parsed keys, so the substring relationship is irrelevant
  and half (b) is red by construction against the pre-rename wire. Genuine guard, not a tautology.
- *Both schema files*: parsed with `python3 -c json.load` rather than eyeballed.
  `pipeline-analyze-response.schema.json` and `pipeline-analyze-proposal-response.schema.json`
  each give `$defs.RootSourceSchema` → properties `['rootId','dataSourceName','sourceSchema']`
  and required `['rootId','dataSourceName','sourceSchema']`. Neither retains the old spelling in
  either place. AC5 met independently of `check:schemas` (which, as the design gate warned, does
  not read `required` inside untitled `$defs`).
- *AC3*: `openspec/specs/pipeline-analyze-api/spec.md:116` reads "...with the bound DataSource's
  name on that entry as `dataSourceName`". The `:50` mention is the retired singular scalar,
  correctly left per the AC's scope clarification.
- *AC1/AC2*: confirmed above; no per-root protocol shape carries the `source`-prefixed spelling.

**Gates re-run by me, output read (not relied on from evaluation-1.md).**
- `sbt -batch "testOnly ...PipelineAnalyzeRoutesSpec ...PipelineAnalyzeProposalRoutesSpec"` →
  `Tests: succeeded 42, failed 0`, `Suites: completed 2, aborted 0`, `[success]`. The AC7 test
  appears by name in the log, so it actually ran. (Scoped rather than full `sbt test`: commit 2
  touches zero backend files, and the evaluator's full run at `21f76c14` was 3838/0.)
- `npm run lint` (`--max-warnings=0`) — clean. `npm run typecheck` (`tsc --noEmit`) — clean.
  These two are the ones that actually cover the edited frontend file.
- `npm run format:check` — "All matched files use Prettier code style!" (the rewrapped comment
  is Prettier-clean).
- `npm run check:schemas` — in sync, 74 checked across 48 protocol files.
- `npm --prefix helio-mcp run typecheck` — clean; `npx jest helio-mcp` — 24/24 suites,
  238/238 tests.
- `npm run check:openspec` — clean; `npm run check:spec-structure` — 349 specs, 0 issues.

**No UI surface.** The diff is backend/contract/mcp plus one TypeScript comment; the renamed
field has zero `frontend/src` consumers, so there is no rendered surface, fetch path, or
observable behavior to judge against `DESIGN.md`. Per the orchestrator's direction and the shared
dev-Postgres constraint (concurrent runs), dev servers were deliberately not started. Documented
no-op, not a skipped check.

**Nothing new found**, and commit 2 disturbed nothing commit 1 got right.

### Verdict: CONFIRM

### Non-blocking notes

- In the rewritten comment, "this ticket's AC3 barred..." resolves to HEL-969 via the preceding
  clause ("At the time HEL-969 wrote this"), but "this ticket" sitting in a file that also
  discusses HEL-975 is a hair ambiguous. Naming HEL-969 explicitly there would read cleaner.
  Cosmetic; the paragraph is not misleading as written.
- Unchanged from round 1 and still correct to leave: `openspec/specs/pipeline-analyze-api/
  spec.md:50` names the *retired singular scalar*, explicitly out of AC3 scope. Worth a separate
  cleanup ticket, not this one.
- The PR description must carry the breaking-wire-change statement recorded in
  `files-modified.md`: an out-of-repo MCP client built from an older `types.ts` reads `undefined`
  for this field until rebuilt.
- `PipelineAnalyzeRoutesSpec.scala` has a duplicated `import spray.json._` — pre-existing on
  `main`, not introduced here.
