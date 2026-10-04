# HEL-1233: Repair tool for stored-bad dashboard layout breakpoints (overlapping/out-of-bounds) left grandfathered by HEL-1071

## Description

HEL-1071 rejects invalid layout writes but, per the owner-approved grandfathering rule, a breakpoint identical to the
stored one passes through untouched, so existing stored-bad breakpoints (overlap or out-of-bounds) stay stored-bad until
someone supplies a different valid version. Render-time repair (HEL-1023) covers display only. Consider an explicit
repair path (an owner/agent-invoked 'repair layout' action or one-off maintenance task) that rewrites stored-bad
breakpoints to their resolved (displayed) layout. Also consider the import case: a dashboard exported while holding a
bad breakpoint now 400s on import until fixed.

## Owner Ruling (binding; recorded by the driver when the batch was planned)

- Repair on open, by the OWNER only. When the dashboard owner opens a dashboard whose stored breakpoints are bad
  (overlapping or out-of-bounds, as grandfathered by HEL-1071), write the repaired breakpoints once.
- The write creates no undo history entry and sets no dirty/"Unsaved changes" flag. This is an owner-approved
  exception to HEL-1023's persist-only-on-edit rule.
- Non-owners (shared or public viewers) never write; they keep HEL-1023's render-time reflow.
- Import repairs too: an imported dashboard with bad breakpoints is stored repaired.

## Acceptance Criteria

1. When the dashboard owner opens a dashboard with one or more stored-bad breakpoints (as defined by
   `breakpointLayout.ts` `isLayoutValid` / server `LayoutValidator`), the repaired breakpoints are written once; a
   reopen performs no write.
2. The repair write adds no undo/redo history entry and never sets the dirty / "Unsaved changes" flag.
3. Non-owners (shared grantees of any role, public/share-token viewers) never write; they keep render-time reflow.
   Ownership is enforced server-side, not from client state alone.
4. An imported dashboard whose snapshot carries a bad breakpoint is stored repaired (no 400 for that reason).
5. Every repaired breakpoint passes HEL-1071's server validator — proven with a client/server seam test.
6. The repair write fits the HEL-1230 store-layout classification contract (header of
   `frontend/src/features/panels/hooks/useLayoutSave.ts`) explicitly and is never misread as an undo or a user edit.
7. Repair neither crashes nor drops a live panel's item when the stored layout and the panel list disagree (e.g. a
   Text panel with no server-side layout item — pre-existing, not fixed here).
8. Live UI check in light and dark: seeded bad-breakpoint dashboard, opened as owner (one write, reopen no write) and
   as a non-owner (no write).

## Driver Claims (to verify, not trust)

- "Owner" should be determined server-side; check what the dashboard payload exposes.
- Repair might be better server-side on read; weigh client vs server. RLS: dev/CI run as superuser, so any server-side
  owner check needs a non-BYPASSRLS proof.
- HEL-1230 found a Text panel create adds no server-side layout item (pre-existing, not ticketed): do not fix, but do
  not crash or drop items when layout and panels disagree.

## Constraints

- Parallel lanes: HEL-958 (pipeline join UI, frontend pipelines) and HEL-1258 (Sources "Used by"). Do not touch those
  areas. Migration V116 reserved for this lane if needed (V115 = 1258, V117 = 958).
- Backend gate `nice -n 19 sbt testFull`; at most 2 parallel workers; known flakes FirstRunRoutesSpec / RouteTest 1s
  timeouts (HEL-1228/1225), PanelCard.test.tsx:625 (HEL-1215), ProductEventRollupServiceSpec (HEL-1247) — rerun, don't fix.
