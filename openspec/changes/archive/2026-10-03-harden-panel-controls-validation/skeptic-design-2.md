## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Re-read ticket.md, proposal, design, tasks, spec delta, and skeptic-design-1 cold; checked each round-1 change request against the revised artifacts and the code.
- CR1 (non-vacuous wiring test): design D5 now requires a real DbContext + seeded Output, driving propose AND PUT contents, with per-service mutation reds; task 3.1/3.2 match. Code check: validator referenced in ApiRoutes, DashboardProposalService, DashboardContentsService, ProposalPanelSupport as claimed.
- CR2 (D3 self-contradiction): D3 now states one rule (reject any presence of `controls` key on a non-output panel, incl. [] and null); spec scenario matches.
- CR3 (non-array controls on create paths): D1b added, with explicit keep-tolerance for PanelRowMapper. Code: OutputPanel.scala:227 `readConfigFromWire` -> OutputPanelConfig.decode is the read-time arm, so the executor must keep it off the strict path (design says so).
- CR4 (enumeration gaps): D4 addendum adds batch PATCH (PanelMutationRepository.scala:105 -> PanelConfigCodec.applyConfigPatch, confirmed) and snapshot restore; D1c adds a shared structural helper; write-paths.md persisted in change dir (task 1.2).
- CR5 (id minting rationale): D2 reworded to check final ids after minting.
- Every ticket AC maps to a task: red repro (1.1/1.2), path enumeration (1.2/D4), wiring mutation (3.x), HEL-1002/ExistenceNotLeakedRoutesSpec (2.4).
- No TODO/TBD placeholders found.

### Verdict: CONFIRM

### Non-blocking notes
- D1/D1b/D1c/D4-addendum are appended rather than integrated; tasks 2.1/2.1b cover them, so no ambiguity, just untidy.
- Executor should note PanelConfigCodec.applyConfigPatch (safe -> 400 path used by batch/patch-set apply) already maps decode errors; confirm which of those are truly red before writing tests per path.
- Spec delta scenarios only cover PATCH; consider a scenario for create/batch non-array controls (D1b).
