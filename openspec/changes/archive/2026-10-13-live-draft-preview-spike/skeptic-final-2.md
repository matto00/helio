## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `39707e4c1d884f25fc38f0b4e6a8afe2d0e849ed`. The live base from `resolve-review-base.sh` is `5074b69377ea8ce1010739dddcf858448a3a0af5`, and the diff is 28 files, all under `docs/` or this change dir. There are no `frontend/**` or `backend/**` changes, so there is no UI to judge. Round-1 delta (`2bb5aeae4..HEAD`): `docs/live-draft-preview.md` (+147/-47), `measurements.md` (1 line), and the two review reports.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/live-draft-preview-spike/HEL-1580`.

- **AC2 re-run (own playwright-core Chromium, `nice -n 19`, one browser).**
  - Command: `PLAYWRIGHT_CORE=/home/matt/Development/helio/node_modules/playwright-core nice -n 19 node measure.cjs`, exit 0.
  - Environment: playwright-core 1.55.1, `chromium_headless_shell` 140.0.7339.186, Node v22.23.2.
  - Correctness: `verify.bad=0` and 179 distinct row counts.
  - Unthrottled (1x): recompute median 0.10 / p95 0.30 ms. Recompute + render + sync layout 1.4 / 1.9 / max 7.1 ms.
  - 4x CPU throttle: recompute 0.5 / 1.1 ms. Recompute + render 4.2 / 5.7 / max 10.8 ms. Scaling to 50k rows: 38.9 / 74.2 ms.
  - **AC2 reproduces**: under 50 ms with about 10x headroom even when throttled.
  - The JSON is at the scratchpad path `skeptic-final2-measure.json`. `persist-evidence.sh` refused it as outside the git tree, so the numbers are quoted here instead. No verdict rests on them.

- **§12 vs HEL-1581:** a script check confirms all five quoted ACs appear verbatim in the scratchpad `HEL-1581.md` (whitespace-normalised): 5/5 `True`.

- **Round-1 CR1 (limiter mounting): fixed in substance.**
  - `ApiRoutes.scala` confirms the order: `requireCsrfHeader` → `rateLimitDirective.rateLimit()` → `confineScopedToken` → the auth branches. The dedicated limiters are nested inside that wrap, and the comment says "BOTH checks run on every matched request".
  - §6.3 now mounts the endpoint outside the general bucket with its own directive and env var, and names the path-exemption scaffolding.
  - §11 and §12 item 2 and split (d) are consistent with that.
  - `AuthDirectives.scala:179-190`: `requireCsrfHeader` passes `GET`, so the restored WebSocket-handshake CSRF point is accurate.

- **Round-1 CR3 (undo after deletes): fixed.** §8.5 gives three stances and a recommendation, and §12 lists it as open owner question (2). The overwrite-on-409 call is open owner question (1). C1 is satisfied: neither is silently decided.
  - `PatchSetUndoInverse.scala:79` (panel undo recreates under a new id) matches the citation.

- **Round-1 CR4 (prefix label): fixed.** §4 rule (1) applies to any source over `SAMPLE_MAX`, static included. §12 item 5 mirrors it and says it adds to the AC's scope.
  - Facts check out: `DatasetMaxRows = 500` (`DataSourceService.scala:1427`); CSV-from-URL exists (`createCsvUrl`/`CsvUrlFetch`, `DataSourceService.scala:279-336`), so "a CSV with a live URL" is real.

- **Round-1 CR2 (pipeline-row lock): partially fixed. See CR1 below.**
  - **SERIALIZABLE claim: correct.** PostgreSQL SSI only records rw-conflicts for writes made by serializable transactions; a `READ COMMITTED` writer takes no SIREAD/conflict checks. A RC writer that changes rows the save read but does not itself write is therefore not detected. Only a write-write on the same row raises a serialization failure. Rejecting SERIALIZABLE-with-retry as a substitute is sound.
  - **The step/Output/root/schedule writer list matches the tree.** I enumerated the `def`s in `PipelineStepRepository`, `OutputRepository`, `PipelineRootRepository`, `PipelineRepository` and `PipelineScheduleRepository`.
    - Not listed: `PipelineStepRepository.update` (:278) and `insertRootStep` (:252), which have no production callers (grep found none); `OutputRepository.updateSchemaInternal`, where `schema` is not in `OutputKeys` (so it is correctly excluded); and `PipelineRootRepository.compactPositions`, which only runs after `removeAction`.
  - **The list is incomplete against the fingerprint the doc itself reuses.** `PatchSetPipelineDefinition.of` (`PatchSetPipelineDefinition.scala:12-15, 31-36`) puts `panelIds` (via `panelRepo.findIdsByOutputIdsInternal`) and `alertRules` (via `outputRepo.findAlertRuleDefinitionsInternal`) into the pipeline definition. Their writers are not in the list:
    - `PanelRepository.insert` (:211), `delete` (:230), and the batch config-patch/`replace` that writes `output_id` (:309-338);
    - `AlertRuleRepository.insert`/`update`/`delete` (:78/:85/:99).
  - Despite that, §8.3 asserts "the check and the writes are atomic with respect to **every** writer, and the journal's 'prior definition' (8.5) is **exactly** the state that was replaced."

### Verdict: REFUTE

Three of the four round-1 items are fixed in substance, AC2 reproduces, and §12's quotes are verbatim. One guarantee the doc makes is still not delivered, and §12(c) points HEL-1581 at it as the scope of record.

### Change Requests

1. **§8.3's "every pipeline-definition writer" list omits the panel and alert-rule writers that the reused fingerprint covers.** File: `docs/live-draft-preview.md` §8.3 (the "Writers in the tree" paragraph and the "atomic with respect to every writer" sentence), with §12 split (c) deferring to it.
   - **The scenario:**
     1. A Save & run deletes an Output.
     2. Meanwhile someone binds a panel to that Output: another user's dashboard, through `PanelRepository.insert` or a "Swap output" `output_id` patch.
     3. That write takes no pipeline-row lock. It commits after the save's fingerprint read; the save's `DELETE` on `outputs` waits on the FK key-share lock, then cascades.
   - **The consequences:**
     - The new panel is deleted **outside the cascade the user confirmed** (§8 "Cascade confirmation").
     - It is **absent from the journaled prior definition**, so undo stance 1 (§8.5, the recommendation) sees the Output as having "no bound panels" and recreates it without the 409 that is supposed to name every lost panel. The panel is lost silently.
     - Alert-rule writes race in the same way.
   - **Fix:** do one of the following, and then correct the "every writer / exactly the state replaced" sentence and §12(c).
     - Add the panel `output_id` writers (insert, delete, the config-patch/replace path) and `AlertRuleRepository.insert/update/delete` to the lock list. They would lock the pipeline row of the Output they reference.
     - Or have the save lock the affected Output rows `FOR UPDATE` before reading the cascade (an FK insert needs `FOR KEY SHARE`, which conflicts), plus lock existing panel rows as HEL-1498's `PanelRowLocks.lockForDeletion` already does for pipeline delete (`PipelineRepository.scala:514-520`). State which writers that still leaves out (for example a panel unbind) and why that is harmless.

### Non-blocking notes

- **§6.3 "mounting the route in a branch that sits before `rateLimitDirective.rateLimit()` but after authentication":** in the tree, `confineScopedToken` (the HEL-369 single chokepoint) also sits inside the general rate-limit wrap. A branch hoisted above it must re-apply `confineScopedToken`, or a hook-scoped token could reach draft-preview. "Only the shared counter is skipped" implies this, but naming it would stop an implementer from missing it. The path-exemption option avoids the issue.
- **§11, "only viable shape" for the outside-bucket limiter, is slightly overstated.** A nested dedicated limit set well below 120 (with a slower client floor) would also bind first. It is rejected on latency under ruling A, which the §6.3 text does say. This is an architecture call, not a product call, so C1 is not violated.
- `PipelineStepRepository.update`/`insertRootStep` have no production callers. Listing them as "not locked, dead" would make the enumeration's completeness explicit.
- **Gate-defect check:** no report I drilled into relies on mtime ordering, so there is nothing to record.
