## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

All checks run fresh against the live worktree tree; nothing taken from the orchestrator's message.

**(a) Round-3 CR6 repeat-survival — DuplicateDashboardResponse.** FIXED, verified by my own grep:
`specs/dashboard-export-import/spec.md:4` now contains "The response SHALL contain the new dashboard
and its panels, matching the shape of `DuplicateDashboardResponse`." This matches
`DashboardSnapshotRoutes` returning that type. No longer a claim-only fix.

**(b) Gap A — `outputRepo = null` default is sound.**
- `OutputRepository.findByIdOwned(id: OutputId, user: AuthenticatedUser): Future[Option[Output]]`
  exists exactly as Decision 5 states (`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala:132`).
- `DashboardService`'s ctor is `(dashboardRepo, accessChecker, auditService: AuthService = null)(implicit ec)`
  at `services/dashboards/DashboardService.scala:34-41` — a trailing defaulted `outputRepo: OutputRepository = null`
  is shape-compatible (last param of the first param list, before the implicit list). Correct Scala.
- 17 `new DashboardService(` sites confirmed by grep; exactly 1 is production (`ApiRoutes.scala:242`).
- The production site has a real repo in scope: `ApiRoutes.scala:182` defines `outputRepoOpt`, and
  `outputRepoOpt.orNull` is already the established pattern at lines 246/249/252/274/278/306/315.
  So `new DashboardService(dashboardRepo, accessChecker, auditService, outputRepoOpt.orNull)` compiles.
- The "null-skips" convention is real, not invented: `PanelService.scala:65-69` and its
  `rejectMissingOutput` at :474-482 (`case Some(_) if outputRepo == null => Right(())`).
- Task 2.1's requirement that the new import test wire a *non-null* `outputRepo` is present and
  explicit ("not done until at least one such non-null-wired test exists") — closes the vacuity risk.

**(c) Gap B — decode + validateConfig actually integrates, and does not conflict with Gap A.**
- `PanelConfigCodec.decodeCreateConfig(kind: String, json: Option[JsValue])` exists with exactly the
  signature Decision 5 cites (`domain/panels/PanelConfigCodec.scala:45`), and rejects unknown kinds.
- `DashboardSnapshotPanelEntry` is `(snapshotId, id: Option[String], title, type: String, appearance:
  PanelAppearancePayload, config: JsValue)` (`DashboardProtocol.scala:85-92`). Critically, `appearance`
  is already a `PanelAppearancePayload` — so `PanelServiceHelpers.resolveCreateAppearance(Some(entry.appearance))`
  (`PanelServiceHelpers.scala:68`) is a direct, type-compatible call. Decision 5's "existing
  appearance-payload decode/validate path `PanelAppearancePayload` already uses" is accurate, not hand-waving.
- The helper object is reachable: `PanelServiceHelpers` members are `private[services]`, and
  `DashboardService` lives in `com.helio.services.dashboards` (a subpackage of `com.helio.services`).
  Precedent already exists — `services/patchsets/PatchSetPreviewProjection.scala:137-142` calls
  `resolveCreateConfig` / `resolveCreateAppearance` / `buildNewPanel` from a *different* subpackage
  today. This is the exact integration failure mode round 3 caught, and it does not recur here.
- Coverage vs. `buildForCreate`: `buildForCreate` (`PanelService.scala:177-209`) = resolveCreateConfig +
  resolveCreateAppearance + rejectMissingOutput + buildNewPanel + `panel.validateConfig`. Decision 5's
  plan reproduces all five: config decode (Gap B), appearance decode/validate (Gap B), outputId
  existence (Gap A's `findByIdOwned` — the *same* call `rejectMissingOutput` makes), construction +
  `validateConfig` (Gap B). Nothing in `buildForCreate` is missed. `rejectCompanionBinding` was deleted
  in HEL-904 (`PanelService.scala:461`, `PanelServiceHelpers.scala:194`) so it is not a gap.
- Redundancy/conflict question: **no conflict.** `rejectMissingOutput` itself calls
  `outputRepo.findByIdOwned(outputId, user)` (`PanelService.scala:482`) — identical semantics to Gap A.
  The outputId check exists once (Gap A); Gap B deliberately excludes it. Coherent split.
- `validateConfig` is substantive, not a no-op stub: real implementations on `OutputPanel.scala:71`
  and `DividerPanel.scala:98` (others `Right(())`). So Gap B buys real enforcement.
- Decision 5's claim that import skips this today is accurate: `DashboardServiceValidation.scala:39-50`
  documents the skip in-code, and `importSnapshot` (`DashboardService.scala:288-307`) goes straight to
  `dashboardRepo.importSnapshot` after `validateSnapshotPayload`.

**(d) Allowlist coherence.**
- Decision 6 clauses (i)-(iv) are internally consistent; ticket.md AC 6 now points at Decision 6 and
  enumerates all four clauses incl. "tests asserting absence of a retired route/field"; task 7.2 does
  the same and explicitly supersedes the old narrower wording. Round-3 CR3 closed.
- Clause (iv)'s two cited guards are real and quoted accurately: `frontend/src/shared/chrome/sections.test.ts:110-114`
  (`expect(sections.some((s) => s.path === "/metrics")).toBe(false)`) and
  `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala:3425-3428` (`Get("/api/metrics") ... NotFound`).
  Round-3 CR4 closed.
- §3.5 schema list corrected and correct: `grep -rln "dataTypeId\|DataTypeId\|metricId" schemas/` returns
  exactly the 5 files named, including `schemas/workspace/workspace-context.schema.json`, whose
  `leftDataTypeId`/`rightDataTypeId` are in a `"required"` array at :222 and `outputDataTypeId` at :347.
  Round-3 CR5 closed.
- `grep -rln dataTypeId openspec/specs | wc -l` = 19, matching task 3.6's stated count.

**(e) Drift check.** Decision 1/2's public-path claims verified against
`routes/dashboards/PublicDashboardRoutes.scala`: `authorizeResourceWithSharing` at :73,
`panelRepo.findAllByDashboardId` at :79, the `*Internal` convention at :54-56. An unauthenticated-safe
rows variant is feasible — `OutputService.rows` (`services/pipelines/OutputService.scala:253-262`)
differs from what's needed only by `findById(id, user)` vs `findByIdInternal(id)`, and its
`nodeSnapshotRepo == null` arm already returns an empty page, which is exactly the spec delta's
"Missing or unresolvable Output degrades gracefully" scenario. No task/design/ticket contradictions found.

### Verdict: CONFIRM

Every load-bearing claim the orchestrator made in the round-3 remediation is independently true against
the live tree. The two previously-fatal integration questions (Gap A's constructor threading, Gap B's
service-layer validation path) both resolve cleanly, with existing in-repo precedent for each. The
design is implementable as written.

### Non-blocking notes

- `proposal.md` still describes Gap A as "reusing `PanelService`'s existing `rejectMissingOutput`/
  `findByIdOwned` check", and `specs/dashboard-export-import/spec.md:4` carries the same parenthetical.
  Design Decision 5 correctly says the private method cannot be called cross-class and that
  `findByIdOwned` is invoked directly. The wording is defensible as describing *equivalence* rather than
  mechanism, so it is not a blocker — but if the executor reads proposal.md first it may waste a cycle
  attempting the private-method route. A one-line wording tweak would remove the trap.
- Decision 5's Gap B does not mention that `DashboardServiceValidation.validatePanelEntries` *already*
  calls `PanelConfigCodec.decodeCreateConfig(entry.type, Some(entry.config))` today. The genuinely new
  enforcement is appearance normalization + `panel.validateConfig`. The executor should extend that
  existing loop rather than add a second decode pass.
- Gap B needs a `PanelId`/`DashboardId`/`ResourceMeta`/`ownerId` to call `buildNewPanel` for a
  validation-only construction, before the repo mints real ids. Throwaway placeholders are fine since
  only `validateConfig` is consulted, but the design doesn't say so explicitly.
- Allowlist clause (iii) says the `HEL-NNN` reference must *prefix* the text. `schemas/panels/panel.schema.json:113`'s
  description carries "(HEL-904 task 3.6)" mid-sentence, not as a prefix. It plainly falls under the
  clause's spirit (a historical-removal record), and task 3.5 sends it to triage anyway — but a strict
  reading of "prefixed" would exclude it.
- Task 3.1's inline parenthetical restates only allowlist clauses (i)-(iii) and omits (iv), while
  correctly deferring to Decision 6 by name in the same sentence and in the section heading. 7.2 and
  ticket AC 6 both carry all four, so the exit condition is unambiguous.
