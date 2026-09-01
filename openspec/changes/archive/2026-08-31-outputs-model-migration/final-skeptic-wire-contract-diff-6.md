## Skeptic Report — final gate, axis: wire-contract diff (round 6, verification round)

HEAD `0ac6c4ec` vs `main`. `git status --porcelain` empty. Fresh cold derivation; round 5's report
and `execution-progress.md` read as claims to verify.

Filename note: `next-report-number.sh` returned `skeptic-final-1.md` — it still does not model this
change's multi-axis `final-skeptic-<axis>-<n>` convention (round 4/5 note). Used the orchestrator's
explicitly-supplied path; verified by `ls` that no `-6` file pre-existed, so no collision.

### What I verified (with evidence)

1. **Round-5 A — `combined-proposal.schema.json:5` sentinel rule is corrected.** Now reads
   "`config.dataTypeId` only for a panel type outside `output` (i.e. text/markdown/image)". Ground
   truth `CombinedProposalService.configIsBlessed:122-125` =
   `!DashboardProposalService.DataPanelKinds.contains(panel.type) && panel.dataTypeId.isEmpty && …`,
   and `DashboardProposalService.scala:159` is `DataPanelKinds: Set[String] = Set("output")`.
   Text now matches ground truth exactly, including the "flat field absent" clause.

2. **Round-5 B — all three `dashboard-proposal.schema.json` strings corrected.**
   - `:38` `dataTypeId`: "Omitted for text/markdown/image panels — TextPanelConfig/
     MarkdownPanelConfig no longer carry a data binding of any kind (HEL-903/904)."
   - `:47` `fieldMapping`: "Not used by text/markdown/image panels — … carry no data binding to map
     fields against."
   - `:104` `config`: surfaces now "output {outputId}; text/markdown {content}; image {imageUrl}",
     and explicitly "a `config.dataTypeId` on a text/markdown panel is silently inert, not a binding
     attempt."
   Cross-checked against `TextPanel.scala:14` / `MarkdownPanel.scala:14`, both
   `case class …PanelConfig(content: String)` — content-only, as asserted. The old HEL-244 binding
   claims are gone. No residual `fieldMapping`/`dataTypeId` binding assertion for text/markdown
   anywhere in the file (`grep -n "dataTypeId\|fieldMapping\|content"`, all hits inspected).

3. **Round-5 C — `ProposalPanelSupport.scala` self-contradiction resolved.** The comment block
   (now `:153-161`) reads "`dataTypeId`/`fieldMapping` remain meaningful ONLY for `"output"`-kind
   panels … corrected round-5 …: TextPanelConfig and MarkdownPanelConfig carry no data binding of
   any kind, so a `dataTypeId`/`fieldMapping` on a text/markdown proposal panel is inert, never a
   real binding." This now agrees with the same file's `bindingCandidate` doc at `:101-108`
   (`private def bindingCandidate(panel) = panel.dataTypeId`, fallback removed outright) and with
   `buildDataConfig:172-174` routing `output` → `{"outputId": …}`.

4. **Round-5 D — the `PanelType.fromString`/`validatePanel` pin now exists and is genuinely
   load-bearing.** `AssistantProposalToolSchemasSpec` gained two cases (`:120`, `:135`) asserting
   `PanelType.fromString(panel.type) shouldBe a[Right[_,_]]` and
   `ProposalPanelSupport.validatePanel(…) shouldBe a[Right[_,_]]` for every panel in every
   `propose_combined` and `propose_dashboard` example.
   Fresh run: `sbt "testOnly *AssistantProposalToolSchemasSpec"` → `Tests: succeeded 12, failed 0`,
   `[success]` (was 10 in round 5; the two new cases are the delta).
   **Would it have caught round 4's `"type": "metric"` bug?** Yes, by construction:
   `model.scala:132-138` `PanelType.fromString` matches only text/markdown/image/divider/output and
   returns `Left("Unknown panel type: 'metric'…")` for anything else, so the round-4 worked example
   would have made the suite red. The class of defect that recurred across three rounds is now
   pinned rather than argued.

5. **Full wire-surface re-sweep vs current HEAD — no scope creep.**
   `git diff --name-status main...HEAD -- 'backend/src/main/scala/com/helio/api/**' 'schemas/**'` =
   16 `D`, 39 `M`, 1 `R088`, **zero `A`** — same inventory as rounds 1–5 (round 5's "55" counted the
   rename as one path; 56 counts both sides of the stat line — no file entered or left the wire
   surface).
   This cycle's own wire delta (`git diff --stat d12b19b2..HEAD -- …api/** schemas/**`) is exactly
   two files, 4 insertions / 4 deletions: `combined-proposal.schema.json` (1 line) and
   `dashboard-proposal.schema.json` (3 lines) — i.e. precisely findings A and B, nothing else.
   The position-writer audit work in this cycle (`PipelineStepRepository.scala`,
   `PipelineStepRoutesSpec`, `PipelineStepRepositorySpliceSpec`, `V94OutputsMigrationSpec`) touches
   **no** wire/API/schema file, as predicted. `ProposalPanelSupport.scala` (10 lines) is
   comment-only (finding C) and lives outside `api/**`.

6. **`node scripts/check-schema-drift.mjs` fresh:** `EXIT=0`, "schemas in sync with JsonProtocols
   (60 checked across 46 protocol files)", "panel-type enums in sync with backend canonical sets
   (7 surfaces checked)". Green — unchanged from round 5. Still structurally blind to `description`
   prose and `.scala` tool schemas (HEL-926's tracked gap, fourth confirmation) — which is exactly
   why finding D's runtime pin mattered.

### Verdict: CONFIRM

All four round-5 discretionary items are closed out and independently verified against ground truth
(not against the executor's narrative). The wire-contract surface is unchanged in scope from every
prior round, this cycle's non-wire audit work did not leak into it, the mechanical gate is green,
and the recurring stale-panel-kind defect class now has a test that would actually turn red.

**No design question and no scope creep found on this axis.** Nothing here requires escalation.

### Non-blocking notes

- `dashboard-proposal.schema.json:64` still documents `orientation` "for divider panels" while
  `divider` is excluded from the `:34` enum — benign and consistent with `:35`'s explicit note, but
  the property remains unreachable through this schema. Carried forward from round 5, unchanged.
- `scripts/concertino/next-report-number.sh` still doesn't model the multi-axis report convention;
  worth reconciling upstream in Concertino (not in this repo — rendered target).
- HEL-926's drift-checker blind spot (description prose + `.scala` tool schemas) remains the
  structural reason this axis needed six rounds; the new spec pin covers the panel-kind slice of it
  but not description prose generally.
