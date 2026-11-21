## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD afc2a687286a73b22660e613adef2dbb85d0d517 (planning artifacts untracked under the change dir).

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/regex-probe-control-headroom/HEL-1808`.
- design.md Context matches `e2e/hel1683-regex-main-thread.spec.ts`: control fill + 3 visibility waits + `waitForTimeout(1500)`
  (lines 139-158), probe `waitForTimeout(3000)` (161-173), overrun closes on the budget error (201-214), bound 100 (26).
- Driver/design evidence claims, re-derived from the main checkout:
  `.concertino/runs/HEL-1697/evidence/scratch/e2e2.log:1946-1947` = control 74.0 ms and probe 72.0 ms (with a
  `/draft-preview` request, so the probe time is not the client regex). Grep over `.concertino/runs/`: control 67 x 0.0,
  58.0 x1, 74.0 x3 (quotations of the same value included); probe 72.0/57.0; overrun 78.0 x2. Matches design.md.
- Round-1 change request 1 (all three windows): ADDRESSED. Decision 1 attributes control, probe and overrun; Decision 2
  defines each window's open (shared quiet/settle point) and close (own result signal + named settle constant) and states
  the fill's synchronous work stays inside; Decision 3 keeps all three log prefixes; Decisions 4/6 record and bound all three.
- Round-1 change request 2 (throttled target): ADDRESSED. Decision 6 and task 3.1 make 1x local x5 + CI the pass gate and
  4x/6x diagnostic only, with explicit escalation triggers.
- "Synchronous in the input handler" claim: the Pattern input's `onChange` (`StringOpsConfig.tsx:84,175`) feeds the draft
  with no debounce, and `usePipelineDraftFrames.ts` evaluates `walker.walk` in a `useMemo` during render (no
  deferral/transition), so a window containing the fill contains a client-evaluated catastrophic task. The mutation (3.2)
  and the control vacuity mutation (3.3, 150 ms busy loop > 100 ms bound) therefore stay meaningful under a narrowed window.
- LoAF availability: `@playwright/test ^1.55.1` ships Chromium well past LoAF's Chrome 123.
- Ticket ACs: AC1 (<= 60 ms on 5 recorded runs, or margin + cause) -> Decisions 4/6; AC2 (mutation red) -> Decision 5 /
  task 3.2. "Do not raise the 100 ms limit" -> C8 + escalation path. Scope e2e-only, avoids HEL-1796/HEL-1813 files.
- No TODO/TBD; tasks consistent with design; no API/schema change so no contract delta needed (skip_specs justified).

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md has no line for Decision 4's CI recording (5 runs + per-leg CPU model from `e2e-runner-shard-<n>`). It is AC1,
  so the orchestrator must carry it through delivery even without a checkbox; consider adding it.
- Probe close signal: `aria-label="Preview is live"` (`StepPreviewTable.tsx:298`) is also shown for CLIENT-evaluated
  draft results, so after the control edit it may still be visible at the instant the probe window starts waiting. Close
  the probe window on a signal that is provably post-fill (e.g. the `/draft-preview` response for the probe pattern, or
  "updating" seen then "live"), otherwise the window can close before the server response the design intends to cover.
  This cannot hide the red (the client work is synchronous in the fill), but it changes what the green measures.
- The 74 ms/72 ms co-occurrence in one run suggests one shared cause (host-level stall or GC) rather than per-window work;
  if attribution says so, the PR should state it as the margin's cause rather than over-fit three different reshapes.
