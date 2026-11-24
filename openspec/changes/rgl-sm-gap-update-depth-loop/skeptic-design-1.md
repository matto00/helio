## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 0548a46403a1f3a5cc85e79519a4945ff0e6c2d4 plus the uncommitted change dir
`openspec/changes/rgl-sm-gap-update-depth-loop/` (ticket.md, proposal.md, design.md, tasks.md,
specs/breakpoint-layout-resolution/spec.md).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/rgl-sm-update-depth-loop/hel-1835`.
- **The cited facts hold in the tree:**
  - `DesktopPanelGrid.tsx:200` renders RGL `Responsive`. `layouts` is a `useMemo` over `[resolvedLayout, panels]`,
    and `onWidthChange` comes from `useProcessedWidth`, as design.md Context says. `dragConfig`/`resizeConfig` are
    new object literals on every render (`DesktopPanelGrid.tsx`, the `Responsive` props). So H3 names a real
    candidate, not a hypothetical one.
  - `ResponsiveGridLayout` is at `frontend/node_modules/react-grid-layout/dist/chunk-7ZM5LVH2.mjs:1307`.
  - `useCommitFlag.ts`, `useProcessedWidth.ts`, `useGridLayoutInteraction.ts` and `DesktopPanelGrid.layoutCommit.test.tsx` exist.
  - The `hel1575-*` specs (8, including `hel1575-delayed-restore-no-update-loop.spec.ts`) and
    `hel1624-direct-load-selection.spec.ts` exist. `openspec/specs/breakpoint-layout-resolution` exists, so the
    ADDED delta targets a real capability.
  - The probe is at `.concertino/runs/HEL-1618/evidence/scratch/skeptic-final/probe-depth.cjs`. It hardcodes port
    7050 and a 1280x1000 viewport, as design.md says. The source finding is HEL-1618 `skeptic-final-1.md:85-93`:
    8-9 errors, 9 with text panels only, 0 on the original layout, and the stack is RGL's sync effect calling
    `setState`.
- **Each ticket AC and driver addition maps to a task:**
  - AC1 (red-first test, no "Maximum update depth") → D3 e2e, tasks 2.1/2.2 (red x3, committed `.txt`), 3.1 (green x3), 3.2 (mutation).
  - AC2 (HEL-1575/HEL-1624 load specs) → task 3.3.
  - "Remove the loop, not silence it; no viewport special case" → proposal What Changes, design Non-Goals, and the
    D3 md/lg loads.
  - "No extra layout PATCH" → the D3 assertion and the spec delta "MUST NOT send a layout PATCH".
  - "Before/after at sm" (DESIGN.md) → D4 and task 3.5, in both themes.
  - "Library change is an ESCALATION" → D2's last bullet and task 1.5.
- **Systematic-debugging law:** D1 and task 1.4 require a named, probe-confirmed cause written to
  `evidence/root-cause.md` before any fix. The hypotheses are listed but none is presumed. Each confirmed cause has a
  fix rule with its own guard: H1 forbids a remount on every resize, H2 keeps the persist-on-edit rule and filters
  through the commit flag, H3 uses a content-keyed memo.
- **No scope drift:** no backend, schema or geometry change. The spec delta adds one behavioural requirement with
  testable scenarios. No contract update is needed, because no API shape changes.
- **No placeholders or TBDs.** The "expected files" list in proposal Impact depends on the probe by design, which is
  correct for a probe-first bug.

### Verdict: CONFIRM

### Non-blocking notes

1. **No rule for "does not reproduce".** No decision rule says what happens if task 1.2 sees 0 errors. HEL-1618
   gives only "items at x=3, w=2 after narrowing", not the exact layout. If the loop does not reproduce, widen the
   repro before concluding it is not reproducible: the probe's 1280 viewport, both themes, form vs text panels, and
   the narrowing done through the UI rather than seeded via the API. If it still does not reproduce, return
   ESCALATION rather than writing a test that is green from the start (that test would not meet AC1).
2. **"Other" cause.** Task 1.4 allows "other", but D2 has no fix rule for it. The binding principle still applies:
   fix at the confirmed cause, in helio, or escalate.
3. **The trace covers only DesktopPanelGrid.** D1's per-render prop trace instruments only `DesktopPanelGrid`.
   `DesktopPanelGridSkeleton.tsx` renders a second `Responsive`, the HEL-1575 site. Use the component stack (D1 b)
   to confirm which `Responsive` loops before you instrument.
4. **Load window.** End the e2e "no PATCH during load" window well before the 30 s auto-save. Match only layout
   PATCHes to `/api/dashboards/:id`, so a preferences PATCH is not counted.
5. **Spec wording.** The spec's "for any valid stored layout" is universal, but only one layout is tested. That is
   acceptable as a requirement statement, but the PR should not claim more than was measured.
