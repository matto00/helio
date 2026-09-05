## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **AC1 E2E test asserts structure, not just success.** Read
   `backend/src/test/scala/com/helio/services/pipelines/Hel914Ac1EndToEndSpec.scala` in full.
   It builds a two-root, two-lane, join-rejoin pipeline via `PipelineService.create`, places
   Outputs via `PanelService.create`, and reads back `WorkspaceContextService.assemble`. It
   asserts (not merely 200s): both root ids in request order; each parentless step's bound
   `rootId`; the join's `secondaryInput` rewritten from the request-scoped clientId "s2" to the
   real persisted step id; each Output's `node.stepId`; and the lane-tree node
   id/parentId/rootId/op/outputIds for all three steps. Ran it directly:
   `sbt "testOnly com.helio.services.pipelines.Hel914Ac1EndToEndSpec"` → 1/1 passed.

2. **patch-set-lane-edits spec's rewritten "Adding a lane" requirement is genuinely backed.**
   Read `openspec/changes/mcp-proposals-lanes-roots/specs/patch-set-lane-edits/spec.md`: the
   multi-edit-chain scenario is removed (deferred to HEL-978, named explicitly), `attachAsTail:
   true` is now required for sibling creation, and a negative "Omitting attachAsTail splices
   rather than branching" scenario was added. Read commit `fce8a609`'s diff to
   `PatchSetApplyServiceSpec.scala`: the new negative test creates a `pipelineStep` WITHOUT
   `attachAsTail`, and asserts the pre-existing child is *reparented under the new step*
   (splice), while the pre-existing positive test (with `attachAsTail: true`) asserts the two
   children remain siblings, neither reparented. The two scenarios assert opposite, mutually
   exclusive structural outcomes — genuinely discriminating, not a restatement. Ran
   `sbt "testOnly com.helio.services.patchsets.PatchSetApplyServiceSpec"` → 41/41 passed.

3. **Four defect fixes verified as real and complete:**
   - `analyze-proposal` fieldMapping grounding (`f20cafc8`): `PipelineAnalyzeProposalProtocol`/
     `PipelineService.scala` extended to ground each proposed Output's `fieldMapping` at its own
     node (including dual-lane rejoin), backed by `PipelineAnalyzeProposalRoutesSpec` additions.
   - `apply_patch_set` zod schema silently stripping `target.parentId` (`68c2dd9e`): confirmed
     the pre-existing inline `editTargetSchema` had no `parentId` field (zod strips unknown keys
     by default); the fix extracts `refinementSchemas.ts` with `parentId: z.string().optional()`
     and a stale `kind` enum fix (dropped `dataType`, added `output`), backed by a new decode
     test `refinementSchemas.test.ts`. Ran via root `npx jest refinementSchemas` → passed (my
     first attempt ran plain `jest` from inside `helio-mcp/`, which fails to parse TS at all —
     the correct invocation is root `jest.config.cjs`, which configures `ts-jest` with
     `NodeNext` resolution specifically to compile this package's tests; re-ran from root and
     it passed cleanly, so my initial anomalous reading was tooling misuse, not a real defect).
   - `attachAsTail` guidance gap (`f20cafc8`): `AssistantSystemPrompt.text` now documents the
     flag; read the full rendered prompt text directly (see item 5 below).
   - `pipelineStep` create ACL pre-validation timing (`0827b4ce`): extends the same
     decode+extract+ownership-check shape already used for `pipelineStep` update to create,
     backed by a new `PatchSetApplyServiceSpec` test.

4. **Task 9.4 (prompt text) evidence.** Read `AssistantSystemPrompt.scala`'s `text` and
   `WorkedExamplesSection` verbatim (not summarized). Confirms: `roots` is a non-empty array;
   each root is EITHER an existing-source branch OR an inline-source branch, "never both
   branches on the SAME root"; `test_connection` is required "for EVERY inline rest_api/sql
   root in roots[] independently — a verified first root does NOT exempt an unverified second";
   `target.parentId` is documented for `pipelineStep` create with `attachAsTail: true` required
   for a sibling lane, with the splice consequence spelled out if omitted. No sentence anywhere
   in the text describes a proposal's source as a singular object.

5. **Full test suites, run fresh, all green:**
   - Backend: `sbt test` → 3769 tests, 248 suites, 0 failures (4m25s).
   - Root/`helio-mcp` Jest (via root `jest.config.cjs`): 230 tests, 23 suites, 0 failures.
   - Frontend Jest: 2617 tests, 254 suites, 0 failures.
   - `openspec validate mcp-proposals-lanes-roots --type change` → valid.

6. **Design-token discipline on the new lane-review UI.** Read
   `PipelineProposalReview.css` in full (added by `c69d0617`): every declaration uses
   `--space-*`/`--text-*`/`--app-*`/`--weight-*`/`--font-mono` tokens, none hardcoded. Consistent
   with `DESIGN.md`. Ran the lane-layout/proposal-review frontend test files directly (54/54
   pass, part of the full 2617 above).

7. **Servers start cleanly.** `start-servers.sh` → both READY; `assert-phase.sh servers` → PASS.
   Navigated to the running frontend; 0 console errors. Did not build a full multi-root proposal
   through the live UI end-to-end (component-level tests already cover the lane-rendering path
   directly and pass), given the component/unit-test coverage already traces this behavior
   structurally.

### Verdict: CONFIRM

### Non-blocking notes
- The dev DB's seeded dashboard title (`HEL909-EVAL4-clobber`) visible on first load is stale
  shared-dev-DB demo data from a prior worktree run (per the known shared-dev-DB Flyway/demo-data
  hazard), unrelated to this change.
- I did not personally drive a full multi-root `propose_pipeline` → apply → undo round-trip
  through the live browser UI; I relied on the passing structural E2E test (item 1), the passing
  component tests (item 6), and direct code reading. Given the AC1 E2E test's assertions are
  genuinely structural and the full suites are green, I did not judge this gap worth blocking on.
