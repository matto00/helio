## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed: `openspec/changes/history-payloads-toggle/`, which contains ticket.md, proposal.md, design.md, tasks.md and three spec deltas. The directory is untracked on top of HEAD `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`. I treated owner rulings Q1–Q4 as settled.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/output-history-payloads-toggle/HEL-1331`.
- **Round-2 CR1 (task 2.3 vs D5): fixed.** Task 2.3 now says to add `historyPayloads` ONLY when `historyPayloadsAvailable === true` and the toggle differs from its seed, and otherwise omit the key. This matches D5 and the spec's "Unchanged switch on a never-set Output" scenario. Task 4.2 tests the absent, null and true seeds. I checked `OutputService.mergeConfig` (`OutputService.scala:485-493`). It does a top-level `existing.fields ++ patch.fields`, so an omitted key is preserved as it was.
- **Round-2 CR2 (identifier): fixed.** D2 and task 1.3 both say `Some((resolvedNodePayloadHistoryRepo, payloadHistoryConfig))`, and both explicitly forbid the nullable param. Ground truth:
  - `ApiRoutes.scala:222` declares `nodePayloadHistoryRepo ... = null`.
  - `:256-257` defines `resolvedNodePayloadHistoryRepo = Option(...).getOrElse(new NodePayloadHistoryRepository(dbContext))`.
  - `:223` declares `payloadHistoryConfig` as a constructor param with a `fromEnv()` default.
  - `:940` is the `new OutputRoutes(outputService, authenticatedUser, Some(outputHistoryService))` site.
- **Round-2 CR3 (Q4 sentence verbatim): fixed.** The exact string "Turning this off stops storing rows; rows already kept expire on the normal schedule." appears in the spec requirement (output-history-payloads-toggle) and in D7. The Q2 help text in the spec is also verbatim from ticket.md.
- **D6 notes: addressed.**
  - The interaction stop is a concrete `wheel`/`touchmove`/`keydown` listener that sets a ref.
  - Only the three page-level flags are tracked. They exist at `SettingsPage.tsx:42-44`.
  - The audit fetch is explicitly not tracked, and the e2e covers it through `waitForSettingsAuditTable` (`e2e/support/settingsReady.ts:16`).
- **Independent review of the ground-truth claims:**
  - **5 REST sites:** `OutputRoutes.scala:43,51,67,73,187` all call `outputResponseFrom`. The constructor's last param is `historyService: Option[OutputHistoryService] = None` (`:30`).
  - **6 patch-set sites:** confirmed at `PatchSetPreviewProjection:138`, `PatchSetApplyForward:106`, `PatchSetApplyRollback:183` and `PatchSetApplyResolvers:682,799,826`.
  - **Tier limits:** `PayloadTierLimit.allowsPayloads = maxRuns > 0 && maxAge > 0` (`PayloadHistoryConfig.scala:11`). The defaults are free 0, beta 10 runs / 7 days, owner 30 runs / 30 days, 1000 rows and 1 MiB. These match the Q2 copy and the spec.
  - **Repository:** `NodePayloadHistoryRepository` has a private `ownerLimit` and uses `ctx.withSystemContext` (`:40`, `:128`, `:185`), so D1's placement is consistent.
  - **Frontend:** the shared `Toggle` supports `disabled`, `ariaDescribedBy` and `role="switch"`. `OutputEditorSheet.tsx` is 686 lines, which justifies a separate component.
  - **e2e feasibility:** a beta-tier user can be seeded with `e2e/support/historySeed.ts:106 setUserTierForTest`, so task 4.4 can be done.
- **Coverage and consistency:**
  - Every AC, ruling Q1–Q4 and additional-acceptance item maps to a task: 1.1–1.4, 2.1–2.4, 3.1 and 4.1–4.5.
  - The MCP delta covers the caps, the tier rule, opt-out and `historyPayloadsAvailable`.
  - The schema change is in task 1.4.
  - There are no TODO/TBD markers, and I found no contradiction between the proposal, design, tasks and specs.
  - There is no scope drift. The patch-set and create-mode exclusions are stated and justified.

### Verdict: CONFIRM

### Non-blocking notes

- **The cross-tier scenario's "patches" path.** The scenario says "a free-tier editor grantee reads or patches an Output on a beta-owned pipeline". `PATCH /api/outputs/:id` is restricted to the Output's owner (`OutputService.update`, see `:230`, which returns NotFound to a non-owner). The PATCH half of the test in 4.1 must therefore use an Output the grantee created as an editor. Patching the pipeline owner's Output would return 404, and that is not a defect.
- **Unknown tiers in D1.** The query returns `users.tier` as a string, and `limitFor` takes a `UserTier`. To meet D1's "unknown tier → false", the string must be parsed safely, with a `false` fallback rather than a throw.
- **Beta viewer on a free-owned pipeline.** Carried over from rounds 1 and 2: this viewer follows the upsell to "You have Beta access." It follows directly from Q1/Q3, and task 4.2 pins it.
