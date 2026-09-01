## Skeptic Report — final gate (round 2, proposal/patch-set contract dimension)

Filename note: `next-report-number.sh` returned `number=1 path=.../skeptic-final-1.md`
(it does not see the round-1 fan-out's suffixed `skeptic-final-N-<dimension>.md`
names). Wrote to the orchestrator-specified, unused
`skeptic-final-2-proposal-contract-round2.md` rather than to a path that
semantically collides with the existing `skeptic-final-1-mcp-tools.md`.

### What I verified (with evidence)

**1. parentStepId threading — VERIFIED FIXED, and I reproduced the mutation myself.**

- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala`:
  sealed trait now declares `def parentStepId: Option[String]` (line 33); all
  23 `*StepResponse` subtypes carry it (`grep -c` → 23 declarations, 23
  `jsonFormat8`, 0 remaining `jsonFormat7` formatters); `fromDomain` maps
  `s.parentStepId.map(_.value)` in all 23 cases.
- `PatchSetUndoInverse.pipelineStepCreateRequestFromResponse` (line ~150) now
  reads `fields.get("parentStepId")`.
- `PatchSetApplyRollback.pipelineStepCreateRequestFromPrior` (line 309) threads
  `prior.parentStepId.map(_.value)`. I checked `git show d36bb991^:` on that
  file — it was **already** correct pre-commit, so the new sibling test is a
  guard, not a red-first proof. That is the honest characterization and the
  commit describes it that way.
- The other two `*CreateRequestFrom*` builders are the panel builders
  (`panelCreateRequestFromPrior` / `panelCreateRequestFromResponse`); panels
  have no parent-id analogue, so "not applicable" checks out.
- **Mutation run by me, not trusted from the transcript.** Baseline:
  `sbt -batch 'testOnly ...PatchSetUndoServiceSpec ...PatchSetApplyServiceSpec'`
  → `Tests: succeeded 40, failed 0`. I then set `parentStepId = None` in BOTH
  `PatchSetUndoInverse.scala:150` and `PatchSetApplyRollback.scala:309` and
  re-ran:
  ```
  - should restore a pipelineStep delete edit ... (HEL-766) *** FAILED ***
  - should roll back a mid-set pipelineStep delete ... (evaluator-final-2, exercises PatchSetApplyRollback directly) *** FAILED ***
  Tests: succeeded 38, failed 2
  ```
  Each test is failable by exactly one of the two independent code paths, in two
  different files — the round-1 "same builder twice / vacuous fixture" defect is
  genuinely gone. Both source files restored via `git checkout`; `git status`
  clean.
- Both fixtures now seed a 3-step pipeline where the branch point (`rootStep`)
  is NOT the trunk-last step (`trunkTail`), and assert both
  `shouldBe Some(rootStep)` and `should not be Some(trunkTail)`. The fixture
  genuinely distinguishes the fix from `addStep`'s default trunk-append.

**2. `combinedProposal.ts` sentinel guidance — the retired-panel-kind list is
gone, but the replacement text is materially false about the live backend.**
Ground truth read: `CombinedProposalService.scala`
(`flatIsBlessed`/`configIsBlessed`/`clearBlessedSlot`/`validateOutputRefPositions`/
`resolveOutputRefs`), `ProposalPanelSupport.bindingCandidate`,
`proposalValidation.ts` (`DATA_PANEL_TYPES = {"output"}`),
`proposal.ts` (`PANEL_TYPES`, `panelSchema.config` passthrough), and the
behavioral spec `CombinedApplyProposalDanglingRefSpec.scala`. See Change
Requests.

**3. `config.dataTypeId` arm removal — reconciles with `bindingCandidate`
(which reads only the flat field, HEL-904 task 4.1) but NOT with
`CombinedProposalService.configIsBlessed`, which is live, not dead.** See CR1.

### Verdict: REFUTE

Finding 1 (the parentStepId gap, the substantive defect) is fully and
independently verified fixed. The REFUTE is confined to findings 3/4: the
rewritten sentinel prose replaced one wrong statement with a differently wrong,
still self-contradicting one.

### Change Requests

1. **`helio-mcp/src/tools/combinedProposal.ts` lines 61–71 — "this is the ONLY
   blessed slot" is false, and the same sentence contradicts itself.**
   The live backend has a **two-slot** blessed model
   (`CombinedProposalService.scala`):
   - `flatIsBlessed(panel)` = `panel.dataTypeId.contains("$pipelineOutput")` —
     **kind-agnostic**, no `type == "output"` check anywhere.
   - `configIsBlessed(panel)` = `panel.type` NOT in `DataPanelKinds` **AND**
     flat `dataTypeId` absent **AND** `config.dataTypeId == "$pipelineOutput"`.
     This is live code, read by `validateOutputRefPositions`, `clearBlessedSlot`
     and `resolveOutputRefs` — a text/markdown/image panel's `config.dataTypeId`
     sentinel **is** a blessed slot: it is accepted, cleared, and substituted
     with the real Output id.

   Consequently the new text is wrong on the acceptance behavior it states:
   - "`config.dataTypeId` is never read for binding purposes on ANY panel kind"
     — it is not read by `ProposalPanelSupport.bindingCandidate`, but it **is**
     read by the sentinel machinery this very paragraph is documenting.
   - "anywhere else (**a non-output panel kind**, …) 400s the WHOLE call" —
     false twice over: (a) a text panel with `config.dataTypeId =
     "$pipelineOutput"` alone does **not** 400 (it is blessed —
     `CombinedApplyProposalDanglingRefSpec`'s "Bad Duplicate" case only rejects
     because a *second* occurrence sits in `fieldMapping`); (b) a text panel with
     flat `dataTypeId = "$pipelineOutput"` does **not** 400 either, because
     `flatIsBlessed` never checks the kind.
   - The paragraph also contradicts itself: it says a `config.dataTypeId`
     sentinel "resolves into a silently-inert slot" (i.e. accepted) and then that
     any non-output-kind occurrence "400s the WHOLE call". Both cannot hold.
   - It now *omits* the one `config.dataTypeId` case that genuinely **does** 400
     and has a dedicated test: a sentinel in `config.dataTypeId` on an
     **`output`**-kind panel ("reject a sentinel in config.dataTypeId on a
     DataPanelKinds (output) panel, creating nothing"). An agent reading the new
     text would expect that to be merely inert.

   Rewrite to the actual contract, distinguishing *accepted* from *produces a
   real binding*:
   - The only placement that produces a **real** binding is
     `dataTypeId: "$pipelineOutput"` on an **`output`**-kind panel.
   - Accepted-but-inert (no 400, substituted, then ignored at panel-create):
     flat `dataTypeId` sentinel on a text/markdown/image panel, and
     `config.dataTypeId` sentinel on a text/markdown/image panel whose flat
     `dataTypeId` is absent.
   - 400s the whole call, creating nothing: `config.dataTypeId` sentinel on an
     `output` panel (kind mismatch); `config.dataTypeId` sentinel shadowed by an
     already-set flat `dataTypeId`; any sentinel in `fieldMapping` or any other
     position; any duplicate occurrence alongside a legitimate blessed one.
   (Alternatively, if the intended contract really is one slot, change
   `CombinedProposalService.configIsBlessed` and `flatIsBlessed` to match and
   update `CombinedApplyProposalDanglingRefSpec` — but that is a behavior change,
   not a doc fix, and is almost certainly out of scope here. Fixing the prose is
   the expected resolution.)

2. **`helio-mcp/src/tools/proposal.ts` line ~180 (`apply_proposal` description)
   — same stale class, missed by the round-1 sweep.** It claims "an output
   panel's `dataTypeId`, **flat OR via config**, must resolve to a real,
   caller-owned Output". `ProposalPanelSupport.bindingCandidate` is
   `panel.dataTypeId` only, and for an `output` panel `buildCreateRequest` uses
   `bindingKey = "outputId"`, so a `config.dataTypeId` on an output panel is
   unvalidated passthrough — never resolved, never checked for ownership. Drop
   the "flat OR via config" clause. (Note this directly contradicts the same
   file's own accurate line 145, so the file is currently self-inconsistent.)

### Non-blocking notes

- `PipelineStepProtocol.scala:234` still reads "to satisfy the
  **jsonFormat7**-derived response formatters below" — all 23 are now
  `jsonFormat8`. One-word comment drift introduced by this commit.
- The new `PatchSetApplyServiceSpec` rollback test is a **guard**, not a
  regression proof (its production path was already correct). It is
  mutation-failable, which is the right bar for a guard; worth labelling as such
  in the test comment so a future reader does not infer it was ever red for a
  real defect.
