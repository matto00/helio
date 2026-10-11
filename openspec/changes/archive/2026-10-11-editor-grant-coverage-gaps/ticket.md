# HEL-1488: Editor-grant coverage gaps outside patch-set resolvers (8 surviving mutations) + stale resolveRootDataSources citations

## Description

Follow-up of HEL-1482 (origin_kind: followup, origin_ticket: HEL-1482).

HEL-1482 audited every editor/viewer grant branch in `backend/src/main/scala`. Each branch got a one-line mutation: viewer let through, and, where an editor arm exists, editor rejected. The eight sites below survived the mutations, which `testFull` confirmed: weakening the branch left every spec green.

Code reading shows the intended behaviour at each one, so these are **coverage gaps, not defects**. Each new test must be shown red against the same one-line mutation first, then green. The per-site table and mutation scripts are in HEL-1482's archived change, `openspec/changes/archive/2026-10-11-patchset-resolver-split-followups/mutation-evidence.md`. Line numbers are hints; re-derive them from main.

1. `PanelService` ~:221 (batch update): the viewer-let-through and editor-rejected mutations both survive.
2. `DashboardContentsService` ~:148 (`PUT /api/dashboards/:id/contents`): the viewer and editor mutations both survive.
3. `DashboardService.exportSnapshot` ~:254: the viewer-let-through mutation survives.
4. `AccessCheckerImpl` :83: mapping the public-viewer arm to Editor survives.
5. `AclDirective` :141: mapping the anonymous token-authorized `provide(Viewer)` arm to Editor survives.
6. `ResourcePermissionRepository` :36: changing the unknown-role fallback from `Role.Viewer` to `Role.Editor` survives. This arm is probably unreachable; decide whether to test it or document it.
7. `PipelineRunService.submit` ~:197: the mutation letting a viewer grantee trigger a run survives. **Look at this one first:** the current code correctly returns 403, but nothing pins it.
8. `OutputService.create` ~:140: the viewer-let-through mutation survives.

There are also two stale comment citations of `resolveRootDataSources`, a method that does not exist: one in `PipelineCreateTransaction.scala` and one in `PipelineRootWrites.scala`. The real symbols are `PipelineRootWrites.resolveOneRootSourceId` (blank id -> 400) and `PipelineCreateWrites.lookupOwnedRoots` (unowned -> 404).

Do not change behaviour. If a test exposes a real authorization bug, escalate to the owner before fixing.

## Acceptance Criteria

- AC1: Each of sites 1-8 is pinned by at least one test that goes RED under the one-line mutation HEL-1482 recorded as surviving for that site (viewer let through / editor rejected / arm mapped to Editor), and GREEN on the unmutated tree; site 6 is either so pinned or documented as unreachable with a recorded reason.
- AC2: Where a site has viewer, editor and owner outcomes, each is covered (viewer 403/Forbidden exact; editor and owner accepted, with the effect observed), and each new test is shown red under a one-line mutation of the gate it guards.
- AC3: Assertions are exact (HTTP status + body, or the exact `ServiceError` value), never "not 2xx" or "nothing mutated" alone.
- AC4: The two stale `resolveRootDataSources` citations are corrected to the real symbols.
- AC5: `backend/src/main` changes are comment-only, proven by a non-comment-line diff filter; no behaviour change.
- AC6: A real authorization defect found by a new test is escalated with an exact repro, not fixed and not merged.
