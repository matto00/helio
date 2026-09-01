## Skeptic Report — final gate (round 3, dimension: proposal/patch-set contract consistency)

Filename note: `next-report-number.sh` returned `number=1` (it does not recognize the
suffixed `skeptic-final-2-proposal-contract-roundN.md` names this dimension has used since
round 1), so I used the orchestrator-specified filename, which is collision-free in this dir.

### What I verified (with evidence)

All reads are from ground truth at commit `179aedab`, branch-by-branch, not from the
executor's restatement.

**1. `CombinedProposalService.scala:151–215` read directly**
- `flatIsBlessed` = `panel.dataTypeId.contains(OutputRefSentinel)` — **kind-agnostic**.
- `configIsBlessed` = `!DataPanelKinds.contains(panel.type) && panel.dataTypeId.isEmpty &&
  config.fields("dataTypeId") == sentinel`.
- `DashboardProposalService.DataPanelKinds = Set("output")` (line 159), and
  `PANEL_TYPES = ["text","markdown","image","output"]` (`helio-mcp/src/tools/proposal.ts:44`)
  — so "non-`DataPanelKinds`" is **exactly** text/markdown/image. The doc's enumeration is
  exhaustive, not an over-narrow example list.
- `clearBlessedSlot` clears only the blessed slot and leaves shadowed/kind-mismatched
  occurrences in place; `validateOutputRefPositions` re-serializes and 400s if the sentinel
  survives.

**2. Each doc bullet checked against the corresponding code branch**
- *REAL binding* (flat sentinel on `output` panel): `flatIsBlessed` → substituted
  (`resolveOutputRefs:210`) → `ProposalPanelSupport.buildCreateRequest:120` uses
  `bindingKey = "outputId"` for `type == "output"`. Real binding. ✓
- *Accepted-but-inert, flat sentinel on text/markdown/image*: `flatIsBlessed` is kind-agnostic
  so it passes position validation and is substituted; `validateDataTypeBinding` falls to the
  catch-all `case Some(_) => Right(())` (line 95) for non-output kinds, so no existence check
  and no error; `TextPanelConfig` is `case class (content: String)` with a tolerant
  `decode` that ignores unknown keys (`TextPanel.scala:15,24–33`), `MarkdownPanelConfig` is
  `(content)` and `ImagePanelConfig` is `(imageUrl, imageFit, caption)` — none carry a
  binding. Genuinely inert, not an error. ✓
- *Accepted-but-inert, `config.dataTypeId` on text/markdown/image with flat unset*:
  `configIsBlessed` true (all three conjuncts hold) → substituted into config → dropped by the
  typed decode above. ✓
- *400: `config.dataTypeId` sentinel on an `output` panel*: `configIsBlessed` false on the
  kind conjunct, `flatIsBlessed` false → `clearBlessedSlot` returns the panel unchanged →
  sentinel survives re-serialization → `BadRequest`. ✓
- *400: shadowed `config.dataTypeId`* (flat holds any other value): `panel.dataTypeId.isEmpty`
  conjunct fails → not blessed → survives → `BadRequest`. Covers both the text-panel and the
  output-panel shadow shapes. ✓
- *400: sentinel anywhere else (e.g. `fieldMapping`)*: not a blessed slot, serialized by
  `proposalPanelFormat`, survives the cleared-panel check → `BadRequest`. ✓
- *400: duplicate alongside a legitimate blessed one*: only ONE slot is cleared, so the second
  occurrence survives → `BadRequest`. Verified for both (flat+config on an output panel) and
  (flat+config on a text panel). ✓
- *"before the pipeline is even applied, creating nothing"*: `apply` (line 76) runs
  `validateOutputRefPositions` before `pipelineProposalService.apply`. ✓
- *"exactly one Output required if any dashboard panel uses the sentinel"*:
  `resolveSentinelOutputId` 422s on 0 or >1, with `pipelineProposalService.rollback`. ✓

**3. `proposal.ts:180–183` stale-clause fix** — new text says an output panel's **flat**
`dataTypeId`, "never `config.dataTypeId`, which is not consulted for binding on ANY panel
kind". Matches `ProposalPanelSupport.bindingCandidate` = `panel.dataTypeId` only
(line 108–109). ✓

**4. Swept for other stale sentinel guidance** — `grep -rn "pipelineOutput"` across
`helio-mcp/src`: only `helioApi.ts:753` and `types.ts:784` remain, both internal source
comments (not agent-facing tool descriptions); their mechanics are accurate.

I found **no remaining doc-vs-code mismatch** in any branch.

### Verdict: CONFIRM

### Non-blocking notes
- `combinedProposal.ts` describes the inert slots as "no error". Scoped to position validation
  that is exact, but an *inert* sentinel still counts in `panelReferencesSentinel`, so a text-panel
  sentinel can still trigger the 422 when the pipeline creates 0 or >1 Outputs. The description's
  later "exactly one is required if any dashboard panel uses the sentinel" clause does state this
  correctly, so the contract is not misrepresented overall — a future edit could tighten "no error"
  to "no position error".
- `helioApi.ts:753` and `types.ts:784` still say "output DataType" (pre-rename wording) in
  internal comments. Cosmetic terminology drift for a ticket that renames Types→Outputs; no
  behavioral claim is wrong.
