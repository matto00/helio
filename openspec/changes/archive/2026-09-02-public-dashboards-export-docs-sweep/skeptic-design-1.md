## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**The design's central claim — CONFIRMED TRUE.**
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala:630-632` — `authDirectives.optionalAuthenticate { userOpt => concat(new PublicDashboardRoutes(panelRepo, aclDirective, userOpt, outputRepoOpt, Option(pipelineRepo)).routes, ...) }`. Confirms `PublicDashboardRoutes` is optional-auth as claimed, at exactly the cited lines.
- `ApiRoutes.scala:732` — `outputServiceOpt.fold(reject: Route)(svc => new OutputRoutes(svc, authenticatedUser).routes)`, inside the `authDirectives.authenticate { authenticatedUser => ... }` block opened at line 636. Confirmed authenticated-only.
- `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala:24-26` — `class OutputRoutes(..., user: AuthenticatedUser)`; `path("rows")` at line 89 under `pathPrefix("outputs" / OutputIdSegment)`. Required `AuthenticatedUser`, as claimed.
- `PublicDashboardRoutes.scala:54-56, 65-83` — resolves `dataAsOf` only via `outputRepo.findByIdInternal` → `pipelineRepo.findByIdInternal(...).lastRunAt`; response is `PanelResponse.fromDomain(panel, dataAsOf)`. No row data. Claim holds.
- `frontend/src/features/pipelines/services/outputService.ts:109` — `httpClient.get(/api/outputs/${outputId}/rows)`; `usePanelData.ts:27` confirms it is the sole rows path.
- `AclDirective.scala:70-105` — a real anonymous grant model exists (`permissionRepo.hasPublicViewerGrant`), so the route is genuinely reachable unauthenticated. Decision 1/2 are architecturally sound and the ACL-reuse rationale is correct.

**HEL-940 fold-in footprint — CONFIRMED (understated, if anything).**
- `grep -rn dataTypeId backend/src frontend/src helio-mcp/src | wc -l` → **256** (design cites 216).
- `ProposalPanelSupport.scala` — 23 hits, live: `panel.dataTypeId.isEmpty` (:35), `buildDataConfig(dataTypeId: String, ...)` emitting `"dataTypeId" -> JsString(...)` (:173-178), `bindingKey = if (panel.type == "output") "outputId" else "dataTypeId"` (:120).
- `CombinedProposalService.scala` — 18 hits, live: `flatIsBlessed` (:158), `panel.copy(dataTypeId = None)` (:180), `cfg.fields - "dataTypeId"` (:182), `+ ("dataTypeId" -> ...)` (:212). Not comments. Fold-in premise verified.

**Two premises that do NOT survive contact with the tree** — see Change Requests 1 and 2.

### Verdict: REFUTE

### Change Requests

1. **The export/import premise is false against the live tree; the spec delta as written would regress a shipped wire shape.**
   `DashboardSnapshotPanelEntry` (`backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala:85-92`) is `(snapshotId, id, title, type, appearance, config: JsValue)`. There is **no `typeId` and no `fieldMapping` anywhere in the snapshot path** — `grep -rn typeId backend/src/main frontend/src | grep -v dataTypeId` returns 13 hits, all unrelated comments and `usePanelPolling.ts`. The binding already lives inside `config`: `PanelConfigCodec.encodeConfig` (`domain/panels/PanelConfigCodec.scala:23-30`) emits `OutputPanelConfig(outputId: OutputId)` (`domain/panels/OutputPanel.scala:18`) for an output panel. `PanelConfigCodec`'s own doc comment calls itself "the single source of truth for the CS2c-3c wire-shape collapse".
   Yet `specs/dashboard-export-import/spec.md:4` requires each panel entry to carry **top-level** `pipelineId`, `outputId`, `kind`, `name`, and design.md D4 says the serializer emits these "instead of `typeId`/`fieldMapping`". That un-collapses the v2 `(type, config)` shape to solve a problem that does not exist, and drags a **BREAKING version bump** (`DashboardSnapshotPayload.CurrentVersion = 2` → 3, which hard-400s every existing export per `DashboardServiceValidation.validateVersion:28-33`) into the last ticket before the first production deploy.
   Required: rewrite proposal.md, design.md D4, tasks 2.1/2.3 and the `dashboard-export-import` spec delta against the real v2 shape. Drop the version bump and the top-level-field reshape unless a concrete defect justifies them. Re-scope §2 to the gap that *is* real (CR 2).

2. **State the real export/import defect the reshape was standing in for.** `DashboardService.importSnapshot` (`services/dashboards/DashboardService.scala:288-330`) validates only via `DashboardServiceValidation.validateSnapshotPayload` — version, name, panel `type`+`config` decode, layout references. It never checks that an output panel's `config.outputId` resolves to an Output the *importing* owner can access; `grep -rn outputId backend/src/main/scala/com/helio/services/dashboards/` returns nothing. Importing a cross-workspace snapshot therefore silently creates panels bound to a foreign/dangling `outputId`. That is the genuine pre-prod fix, and it is about `outputId`, not `pipelineId`, and needs no wire change. Spec scenarios and tasks should be restated in those terms (the "named error naming the missing pipeline" AC should become "the unresolvable Output").

3. **There is no public-dashboard frontend view, so task 1.2 and AC 1 are unimplementable as written.** `frontend/src/app/AppRoutes.tsx:73-124` has exactly three unauthenticated routes (`/login`, `/login/verify`, `/register`, plus `/auth/callback`); everything else is inside `<ProtectedRoute>`. There is no `/dashboards/:id`, no `/share/*`, no `/public/*` route, and `grep -rn "dashboards/…panels"` across `frontend/src` finds **no frontend consumer of `GET /api/dashboards/:id/panels` at all**. No dashboard sharing UI exists either — `hasPublicViewerGrant` has no frontend writer (`PipelineShareDialog` is pipelines-only).
   So "public dashboard renders every panel of a migrated dashboard anonymously" (AC 1) and "renders real rows in an incognito/unauthenticated Playwright context" (task 1.2) cannot be satisfied without building a public dashboard viewer page and a dashboard share affordance — unplanned, non-trivial scope on the last ticket before the first production deploy. Required: pick one explicitly in design.md and tasks.md — either (a) scope §1 as **API-only** (new route + RLS smoke, verified by curl/route spec, AC and task 1.2 rewritten accordingly, with a follow-up ticket filed for the missing viewer UI), or (b) escalate the UI build as its own ticket. Do not leave the executor to discover this mid-cycle and improvise a page.

4. **Fix the resulting inconsistency in the `public-dashboards` spec delta.** Its Purpose ("so a public/shared dashboard link renders real data") and the scenario at `specs/public-dashboards/spec.md:29-36` are written against a link-rendering user journey that has no frontend. Restate the scenarios at the HTTP level (request/response), which is what will actually be verified. Also pin the endpoint: `SHALL expose a way for…` (line 24) is unverifiably vague when design.md D1 has already committed to `GET /api/dashboards/:dashboardId/panels/:panelId/rows` — name it in the requirement.

5. **Task 3.4's exit condition is not a gate.** "returns nothing outside comments explicitly noting historical context, **or a follow-up ticket is filed for what's left**" lets an executor discharge the task by filing a ticket, while AC 6 in ticket.md demands the sweep be *clean*. These contradict. Given the whole headline deliverable is a zero-hit sweep, state the pass condition once, unambiguously, and make 3.4 conform to it.

### Non-blocking notes

- design.md Migration Plan (line 99-100) says "old exports still 400 cleanly on **missing** `version`" — the actual mechanism is `validateVersion` rejecting any non-current version (`DashboardServiceValidation.scala:28`). Substance is right, wording is wrong; moot if CR 1 removes the bump.
- The `dataTypeId` count is 256, not the 216 cited. Directionally the same conclusion; worth correcting so the sweep's "expected zero" baseline is honest.
- design.md D2 offers "`panelRepo.findAllByDashboardId` … **or** a new `findByIdInternal`" — pick one. `findAllByDashboardId` is already used by the list route and needs no new repo surface.
- Task 6.1's "≤ 12 interactions" needs the click-counting helper defined somewhere concrete; as written two implementers would count differently (e.g. does a `<select>` open+choose count as one or two?).
