## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/public-dashboards/spec.md`, `specs/dashboard-export-import/spec.md`.

Round-1 change requests, re-verified against the live tree (not the revision notes):

1. **Export/import premise (CR1) — RESOLVED, premise now correct.**
   `backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala:85-92`:
   `DashboardSnapshotPanelEntry(snapshotId, id: Option[String], title, `type`, appearance, config: JsValue)`
   — no `typeId`, no `fieldMapping`; `jsonFormat6` at line 226. The reshape/version-bump is
   correctly dropped from proposal/design/tasks/AC 2.
2. **Real import defect (CR2) — RESOLVED and independently confirmed.**
   `DashboardService.importSnapshot` (`DashboardService.scala:288-306`) runs only
   `validateSnapshotPayload` then goes straight to `dashboardRepo.importSnapshot`;
   `DashboardServiceValidation.scala:16-64` checks version/name/type+config-decode/layout only —
   no `outputId` resolution. The gap is real.
3. **No public-dashboard frontend (CR3) — RESOLVED.** `frontend/src/app/AppRoutes.tsx` has no
   `/dashboards/:id`, `/share/*` or `/public/*` route (routes are login/verify/register/
   auth-callback, `/`, sources, pipelines, connectors, chat, settings, proposal + patch-set
   review, `*`). Scope is now explicitly API+RLS-only (design Decision 3, Non-Goals, task 1.4,
   AC 1, spec Purpose).
4. **Spec delta HTTP-level with pinned endpoint (CR4) — RESOLVED.**
   `GET /api/dashboards/:dashboardId/panels/:panelId/rows` is named identically in the spec,
   design Decision 1, task 1.1 and AC 1. The gating directive is real:
   `PublicDashboardRoutes.scala:72-77` already uses
   `aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, userOpt, ...)`, and the
   `findByIdInternal` convention it cites exists at lines 50-56.
   `openspec/specs/public-dashboards/` does not exist → `## ADDED Requirements` is correct;
   `openspec/specs/dashboard-export-import/spec.md:25` has `Requirement: Import dashboard
   endpoint` → `## MODIFIED Requirements` is correct.
5. **Task 3.4 exit condition (CR5) — RESOLVED** for helio-mcp specifically: it now forbids
   deferring to a follow-up and requires escalation instead, matching ticket AC 6.

New checks against ground truth:

- `PanelService.rejectMissingOutput` exists (`PanelService.scala:474-486`) but is **`private`**
  and returns `ServiceError.NotFound("Output not found")`. `buildForCreate`
  (`PanelService.scala:178-208`) is `private[services]` and is the actual reusable unit.
- Sweep-pattern hit counts, live tree, excluding `db/migration`:
  `dataTypeId` = 195 backend/src + 21 frontend/src + **40 helio-mcp/src**; `DataTypeId` = 124
  backend/src, 40 frontend/src, 11 openspec/specs, 8 helio-mcp/src, 6 schemas/;
  `metricId` = 47 backend/src, 40 openspec/specs, 5 helio-mcp/src, 3 schemas/, 2 frontend/src;
  `type_id` = 67 backend/src, 13 openspec/specs; plus ~400-700 per pattern under
  `openspec/changes/` (archived change docs).
- `grep -rln dataTypeId openspec/specs schemas` → 19 spec files (incl. `patch-set-apply`,
  `patch-set-preview`, `pipeline-proposal-contract`, `mcp-panel-composition-tools`,
  `mcp-edit-in-place-tools`, `assistant-conversation-loop`) and
  `schemas/authoring/combined-proposal.schema.json`, `schemas/dashboards/dashboard-proposal.schema.json`.

### Verdict: REFUTE

The five round-1 change requests are genuinely resolved. The revision, however, leaves the
headline deliverable (§7 sweep) and the HEL-940 fold-in without a coherent, implementable plan,
and introduces two smaller inconsistencies.

### Change Requests

1. **The HEL-940 rename has no contract-artifact task and no spec delta, yet AC 6 / task 7.2
   sweep `schemas/` and `openspec/`.** `dataTypeId` appears in 2 `schemas/*.json` files
   (`schemas/authoring/combined-proposal.schema.json`,
   `schemas/dashboards/dashboard-proposal.schema.json`) and 19 files under `openspec/specs/`
   (47 occurrences), including `patch-set-apply`, `patch-set-preview`,
   `pipeline-proposal-contract`, `mcp-panel-composition-tools`, `mcp-edit-in-place-tools`.
   tasks.md §3 covers only backend protocols/services (3.2), frontend (3.3) and helio-mcp (3.4);
   §4.4 covers only "`openspec/` project-level descriptions". Renaming a wire field without
   updating the JSON Schemas and the capability specs that normatively state it is exactly the
   missing-contract-update case. Add (a) a task renaming the field in `schemas/**` with
   `check:schemas` as its verification, and (b) `MODIFIED Requirements` spec deltas for every
   affected capability under `specs/` in this change (or, if the plan is that these specs are
   updated at archive time, say so explicitly and reconcile it with task 7.2's zero-hit
   requirement over `openspec/`).

2. **Task 7.2's zero-hit exit condition is unachievable as written and gives the executor no
   adjudication rule.** Excluding `db/migration`, the live tree holds e.g. 124 `DataTypeId`
   hits in `backend/src` alone (`domain/panels/package.scala:9`,
   `domain/model/model.scala:751,934`, `api/protocols/panels/PanelProtocol.scala:38`,
   `PublicDashboardRoutes.scala:19`, `PipelineRunRepository.scala:287`,
   `PipelineRepository.scala:331` …), plus 67 `type_id` and 47 `metricId` — the great majority
   are deliberate historical comments recording what was removed (the HEL-849 comment standard),
   and several hundred more per pattern live in archived `openspec/changes/` docs, which are
   records, not code. Neither design.md nor tasks.md contains any decision defining what counts
   as an admissible hit. As written the executor either fails the gate permanently or fudges it.
   Add a design decision fixing the sweep's allowlist explicitly (at minimum: `db/migration`,
   `openspec/changes/**` archives, and historical-reference comments — with a stated rule for
   the last one, e.g. only within a `HEL-NNN`-prefixed comment describing a removal), and
   restate task 7.2 and ticket AC 6 against that allowlist.

3. **§3 covers only `dataTypeId`; the other retired identifiers have no owning task.** Live
   (non-comment) occurrences exist outside the §3 file list — e.g.
   `api/protocols/workspace/WorkspaceContextProtocol.scala:56,58,126` carries
   `leftDataTypeId` / `rightDataTypeId` / `outputDataTypeId` as real wire fields (design
   Decision 6 names `WorkspaceContextProtocol` but tasks 3.2 only lists it under the
   `dataTypeId` rename, and `outputDataTypeId`/`leftDataTypeId` are not that literal string).
   Either extend §3's enumeration axis to every sweep pattern (`DataTypeId`,
   `outputDataTypeId`, `MetricId`, `metricId`, `type_id`, `computed_fields`) or state in the
   design which patterns are rename-work and which are allowlisted per CR2. As it stands,
   task 3.1's enumeration command (`grep -rn dataTypeId …`) provably under-scopes the work
   task 7.2 will be judged on.

4. **Design Decision 6 / task 3.4 state a false, checkable number: "helio-mcp's 10 hits".**
   Ground truth: `grep -rn dataTypeId helio-mcp/src` → **40** occurrences (`src/types.ts:469,
   488, 489, 509, 805, 806`, `src/tools/combinedProposal.ts:65,69,70,72`, …), plus 8 `DataTypeId`
   and 5 `metricId`. This is the same class of error round 1 already corrected once
   (216 → 256). Correct the count in both artifacts, or drop the number and cite the command.

5. **The named validator cannot be called from `importSnapshot`, and its error contract
   contradicts the spec.** `PanelService.rejectMissingOutput` (`PanelService.scala:474`) is
   `private` — not reachable from `com.helio.services.dashboards.DashboardService` — and yields
   `ServiceError.NotFound("Output not found")`, which neither is a `400` nor names the
   `outputId`. Design Decision 5, task 2.1 and the export/import spec delta all require "the
   same check `PanelService` already applies" **and** a named `400 Bad Request` naming the
   unresolvable `outputId`; those two cannot both hold. Resolve it explicitly: name the actually
   reusable unit (`PanelService.buildForCreate`, `private[services]`, which already runs
   config-decode + appearance-resolve + `rejectMissingOutput` + `validateConfig`) or state that
   `rejectMissingOutput` is promoted to `private[services]`, and pin one error contract
   (either accept the existing `NotFound` mapping and change the spec/AC, or specify the
   `BadRequest` mapping at the `importSnapshot` call site) so both readings converge.

6. **Task 2.2's exit condition permits the gap to survive.** `DashboardServiceValidation.scala:39-50`
   documents in-code that import deliberately does **not** apply general cross-field/appearance
   validation ("This does NOT add general cross-field validation to import — see design.md's
   Non-Goals"), while the export/import spec delta now says appearance and kind-specific
   cross-field constraints "SHALL be validated on import exactly as they are validated on direct
   panel creation". Task 2.2 says only "confirm … add coverage if a gap is found" — adding test
   coverage does not close a behavior gap, and "do not add a second validator" without naming
   the first one leaves the fix undefined. Restate 2.2 as a behavior task with a concrete exit
   condition (route import panel construction through the shared `buildForCreate` path, or
   explicitly narrow the spec requirement to what import will actually enforce).

7. **The MODIFIED export/import requirement silently drops an existing normative clause.** The
   baseline (`openspec/specs/dashboard-export-import/spec.md:26`) contains "The response SHALL
   contain the new dashboard and its panels, matching the shape of `DuplicateDashboardResponse`."
   The delta's replacement text omits it. Since MODIFIED replaces the whole requirement, this
   deletes a requirement unrelated to this change. Restore the clause.

8. **A spec scenario has no covering task.** `specs/public-dashboards/spec.md`'s "Missing or
   unresolvable Output degrades gracefully" (empty rows result, not a server error) is not
   exercised by task 1.2, which covers only the shared-dashboard and non-shared-dashboard cases
   from task 1.1. Add it to task 1.2's verification.

### Non-blocking notes

- Design Decision 2's "unauthenticated-safe internal variant of `OutputService.rows`" does not
  exist yet (`OutputService.scala:253` is `rows(id, page, user: AuthenticatedUser)`); that is
  fine as new work, but the tasks would read more precisely as "add an internal variant"
  rather than "call" one.
- Decision 8's click-counting helper definition (count actual dispatched click/Enter events, not
  hand-counted logical actions) is a good, unambiguous acceptance signal — keep it.
