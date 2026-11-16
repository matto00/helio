## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 8fff8eed1ca2b7ee8df6f70aade2a0fa9e76d3a7. The change dir is untracked. Paths are under
`backend/src/main/scala/com/helio/` unless noted.

### What I verified (with evidence)

**Round-2 CR1 (one proposal per turn vs "propose the rest"): resolved in design and specs, with one leftover in the proposal.**
- D5's error text now says "a turn yields ONE proposal: put every edit ... in a single propose_patch_set call".
- D5 states the single-slot model (`capturedProposal`, overwritten on each success).
- D7 says the whole change is one proposal ("Never one proposal per chart").
- D8 counts successful proposes. The new counter is task 1.14.
- The spec scenario matches.
- **Leftover:** `proposal.md` l.23 still says "propose one, then the rest". See CR2.

**Round-2 CR2 (node-schema assembly): resolved.**
- (a) All saved steps carry `enabled`, as in `PipelineAnalyzeReads`. `projectedSchemaAtNode` is explicitly not used.
- (b) Owner-view root reads. Precedent checked: `services/pipelines/PipelineAnalyzeReads.scala` l.95-102 already
  calls `dataSourceRepo.findByIdOwnedByInternal(primaryDsId, pipeline.ownerId)` under HEL-1516. Secondaries use
  privileged `findByIdInternal` (l.80). So the owner view is a usable precedent.
- (c) An output create is rejected when its node, any upstream step or the pipeline itself is edited in the same
  set. Preview and apply then read identical saved schemas.
- (d) `nodeStepId` must name a saved step.
- The mechanism is named and "commits" is corrected.
- Tests 3.5/3.5a cover (b), (c) and disabled steps.

**Claim: "OutputService.create variant skipping triggerBackfill fits PatchSetApplyRollback": TRUE.**
- `services/patchsets/PatchSetApplyService.scala` l.125-157 is a forward loop. Its single success branch (l.147-150,
  `journalSuccess`) is a clean place for a post-walk backfill trigger. The failure branch goes straight to
  `PatchSetApplyRollback.rollback`.
- Rollback compensates a create by deleting `forwardOutcome.newId` (`PatchSetApplyRollback.scala` l.67-76, the
  panel precedent).
- `OutputService.delete` (l.239-247) is owner-of-Output only. The editor who creates an Output is its `ownerId`
  (`insertInternal(ownerId = user.id)`, l.149), so the same editor can roll it back or undo it.
- Reverse order removes the `$ref` panel before its Output.
- `triggerBackfill` is private and called unconditionally at l.157, so a variant or flag is required. The design
  says so.

**Claim: "get_resource-only detail types need no change to workspace-context.schema.json or helio-mcp": TRUE.**
- `WorkspaceSearchService.getResource` has no HTTP route. Its only callers are `AssistantToolExecutor.scala` l.148
  and `WorkspaceSearchServiceSpec`. `ApiRoutes.scala` l.792 only constructs it.
- helio-mcp has no `get_resource`. Its `read.ts` serves the workspace context.
- `WorkspaceResourceDetail` (`api/protocols/workspace/WorkspaceResourceSearchProtocol.scala`) is a separate union
  that already wraps the shared types. New payloads there leave `WorkspaceContext*` untouched.
- The frontend only maps the tool name (`ToolCallIndicator.tsx` l.21).
- Implementer note: `WorkspaceSearchServiceSpec` l.303/329 pattern-match on the current detail cases and will need
  updating.

**Claim: "a Test/runMain object under backend/src/test is never discovered by testFull": TRUE.**
- `Test / testGrouping` (`backend/build.sbt` l.219) shards over `definedTests`. Those are ScalaTest-discovered
  suites only.
- Two plain-`main` precedents exist: `RetentionTickMeasure.scala` and `HistoryThinMeasure.scala`. Both are run with
  `sbt "Test/runMain ..."`.

**New problem: a Test-scope runner cannot get the Anthropic key or the dev DB URL (see CR1).**
- `build.sbt` l.154 sets `Test / envVars := DevEnv.testEnv`, which holds only the two `CONNECTOR_MASTER_KEY*` values.
- `backend/project/DevEnv.scala` l.37-46 lists `ANTHROPIC_API_KEY` and `DATABASE_URL` in `deniedTestKeys` (HEL-1450).
- Only `Compile / run / envVars` (l.151-153) forwards `.env` values to a JVM.
- A forked test JVM inherits only the sbt process env. I checked presence only, printing no values: neither
  `ANTHROPIC_API_KEY` nor `DATABASE_URL` is set in the ambient shell.
- So D8's runner, as specified, starts with no key and no dev-DB URL. The only obvious workarounds are forbidden
  (sourcing `.env`) or undercut a security guard (forwarding `.env` keys into the Test scope). This blocks task 0.4,
  the first real task.

**Round-1 CRs: no regression.**
- OutputService reuse is corrected.
- The `sendWithTools` partition is unchanged.
- Discovery links are in D1.
- The refinement wording is task 1.12.
- The eval measurement definitions are intact.

### Verdict: REFUTE

### Change Requests

1. **D8 / task 0.4 / task 1.14: say how the eval runner gets `ANTHROPIC_API_KEY` and the dev-DB connection without
   reading `.env`.**
   - `Test / envVars` is fixed to `DevEnv.testEnv`, and `deniedTestKeys` deliberately keeps both keys out of test
     JVMs.
   - Pick one and add tasks for it:
     - (a) Drive each case over HTTP against the lane's own dev backend, started with `start-servers.sh` (which gets
       `.env` through `Compile/run/envVars`). Use the eval user's session or PAT and `POST
       /api/assistant/conversations/:id/converse`. Count tool results and isError from the persisted conversation,
       and successful proposes from a response field or the persisted proposal. The runner then needs no secrets.
     - (b) Any build change that forwards `.env` keys into a Test-scope run. This weakens HEL-1450, so it needs an
       explicit owner ruling (ESCALATION), not a planner self-approval.
   - The same answer must cover D3's "one live call confirms the schema form".
2. **Fix the leftover round-2 CR1 contradiction in `proposal.md` l.23.**
   - "propose one, then the rest" contradicts D5/D7's one-proposal-per-turn model, and the prompt is written from
     these artifacts.
   - Reword it to match D7, for example "make the whole change one proposal; fix and re-propose it if it fails".
3. **Fix the stale gate in `specs/assistant-pipeline-authoring-eval/spec.md` l.21.**
   - It says "without the eval tag and the `HELIO_ASSISTANT_EVAL=1` opt-in", but D8 dropped the tag (runMain, not a
     suite).
   - Reword it to "`sbt testFull` (the runner is a `main` object, not a suite; it also refuses to start without
     `HELIO_ASSISTANT_EVAL=1`)".

### Non-blocking notes

- D2's rejection when "the pipeline itself" is edited in the same set (for example a rename) is stricter than
  needed. It is harmless and keeps preview and apply identical.
- `OutputService.delete` cascades bound panels (`deleteWithPanelsInternal`). Undo and rollback are correct because
  the panel is removed first in reverse order; a test should pin that order.
- `WorkspaceSearchServiceSpec` cases l.303/329 must be updated with the new detail types.
