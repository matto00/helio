## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Re-read design.md (incl. Amendments A1-A5), spec.md, tasks.md against round-1's 7 requests and against code (Modal.tsx native <dialog> w/ own Tab wrap; usePortalPopover.ts focus-out only engages when panelRef attached; OP_TYPES in stepNarrowing.ts).
1. rowCount null: Context + spec now map lastRun null -> never run; succeeded+null -> "produced no rows"; no backend change. Addressed (spec scenario fixed).
2. Public token: Decision 8 signature (dashboardId, panelId, token), cache key excludes token (stated), test asserts token sent; tasks 3.1 covers it. Addressed.
3. Trigger location: A1 names concrete location per all five paths, 44px target, and the detail-modal "Open pipeline" relationship. Addressed.
4. Event isolation: A2 stopPropagation on trigger/popover, capture-phase Escape with stopPropagation, portal into the <dialog> for modals; spec requirement + scenarios added; tasks 3.1 lists the tests. Addressed.
5. Focus trap: A3 own Tab wrap, no panelRef (confirmed that is what avoids the hook's focus-out close), focus returns to trigger. Spec wording consistent. Addressed.
6. Badge: A4 specifies mapping (invalid, warned/rootBound irrelevant), real <button> with label, concrete module-level per-output promise cache. Addressed.
7. Labels: A5 names module, OP_TYPES, humanised fallback, empty-path "Direct from source". Addressed.

### Verdict: CONFIRM

### Non-blocking notes
- Original Decisions 1, 3, 4 bodies still contain superseded text ("executor places...", "close on focus-out acceptable", "executor decides dedupe"). Amendments explicitly override; the executor must follow A1-A5 and ideally the stale sentences get struck.
- OP_TYPES intentionally excludes `join`; a join kind in nodePath will hit the humanised fallback - add a test for it.
- Tasks 2.3/2.4 do not restate A1-A5 specifics; executor must read the Amendments section.
