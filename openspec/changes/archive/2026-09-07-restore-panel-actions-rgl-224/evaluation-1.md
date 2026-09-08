# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: 9ed35f7b, base origin/main @ 6b081b86.
All gate/mutation/browser evidence below was produced by this evaluator's own fresh runs; the
executor's pasted transcripts were re-executed, not trusted.

## Phase 1: Spec Review — PASS

Issues: none.

- Ticket ACs:
  - Mechanism named and demonstrated: yes, and independently re-confirmed in a real browser here —
    `.panel-list__zoom-container` carries inline `width: 100%`, and Chromium reports
    `getComputedStyle(...).width === "1152px"` (USED value) while jsdom returns the literal `"100%"`
    (SPECIFIED value). That asymmetry is the whole defect and it is now observed, not argued.
  - Not a product regression -> no product fix required; `git diff origin/main..HEAD -- frontend/src/features`
    is empty (verified), and `frontend/src/app/App.test.tsx` is byte-identical to main (verified).
  - Mutation-proven guard: verified independently (Phase 2).
  - Real-browser verification: redone here with the Playwright MCP browser (Phase 3).
  - PR-body statement about Dependabot #481: task 5.2, Delivery-phase, still open — correctly so at
    Evaluation. `files-modified.md` already states the required wording ("supersedes #481, does not block").
- Tasks 1.x–4.x are all checked and match what landed. 5.1/5.2 are Delivery-phase and legitimately unchecked.
- Scope: diff is exactly lockfile (3 lines) + `jest.setup.ts` + 2 new guard test files + openspec artifacts.
  No table-panel code, no `PanelGrid`/`PanelCard`/`ActionsMenu`, no HEL-1023/HEL-1006 absorption. No scope creep.
- `skip_specs: true` is correct: no capability behavior changes.
- Planning artifacts (design.md D2 revision, workflow-state root cause) match the implemented shim.

## Phase 2: Code Review — PASS

Gates re-run by me from `frontend/` (NOT root `npm test`, per the directive):

```
npx jest            -> Test Suites: 274 passed, 274 total / Tests: 2770 passed, 2770 total
npm run lint        -> eslint src --max-warnings=0, clean (exit 0)
npm run format:check-> All matched files use Prettier code style!
npm run typecheck   -> tsc --noEmit clean
npm run build       -> success
```
Backend untouched -> `sbt test` not applicable.

### Guard vacuity — the primary risk, checked hard

Both guards were re-mutated from scratch by me (mutation applied, run, restored, `git diff --exit-code` clean):

1. **`widthMeasurementShim.test.tsx`** — mutation: neuter the shim in `jest.setup.ts`
   (`if (typeof style.width === "string" && style.width.endsWith("px"))` -> `if (true)`), i.e. the fix the change
   actually adds, not the withdrawn `clientWidth` stub.
   Result: **RED**, `Expected: >= 768 / Received: 100` — exactly the diagnosed value
   (`Number.parseFloat("100%")`). The same mutation also turned `panelActionsAccessibleName.test.tsx` and both
   `App.test.tsx:893` assertions RED (`4 failed, 27 passed`), reproducing the original defect end-to-end.
   Non-vacuity of the *node*: the guard asserts against the real `.panel-list__zoom-container` rendered by the real
   `PanelList` and includes an explicit sanity assertion `style.width` matches `/%$/` — so it cannot silently
   degrade into the bare-`div` shape that caused design-gate round 1's REFUTE. Confirmed by reading the test, and
   the `Received: 100` value proves the percentage path is the one being exercised.
2. **`panelActionsAccessibleName.test.tsx`** — mutation: `label={`${panel.title} panel actions`}` ->
   `label={`${panel.title} MUTATED`}` at `PanelCard.tsx:303`.
   Result: **RED**, `Unable to find role="button" and name /panel actions/`. Restored, `git diff --exit-code` clean.
   It renders the real unmocked `PanelList -> PanelGrid -> DesktopPanelGrid -> PanelCard -> ActionsMenu` chain, so
   the name asserted is the product's, not a mock's.

Both files are explicitly labelled GUARD (not proof) in their headers, with the proof correctly attributed to the
unmodified `App.test.tsx:893` assertions. This satisfies the proof/guard separation rule.

### Other code-review checks

- Fixture integrity: no fixture was edited to make anything pass; `App.test.tsx` and all product files are
  byte-identical to main.
- Readability / self-documentation: the `jest.setup.ts` comment states the non-obvious mechanism (SPECIFIED vs USED
  value) and the durable rule (depend on the outcome, not on which primitive the library reads). This is the
  strongest part of the change — it is what will save the next bump.
- Type safety: no `any`; the `as typeof globalThis.getComputedStyle` cast is confined to the assignment and is
  needed because the shim's overload set cannot be expressed structurally. Acceptable and localised.
- No dead code, no TODO/FIXME, no over-engineering, no duplication (the isolation technique mirrors the existing
  `PanelList.gridWidthSharing.test.tsx`).
- No inline fully-qualified names (CONTRIBUTING pet-peeve rule) — clean.
- Deferrals name real, filed tickets: HEL-1023, HEL-1006, HEL-301, and Dependabot #481.
- Blast radius: measured, not asserted — 274/274 suites green with the shim in place versus a 1-failed baseline.

## Phase 3: UI Review — PASS

Servers: `start-servers.sh` reused a healthy backend; `assert-phase.sh servers` -> `PASS servers`.
Driven with the Playwright MCP browser against `http://localhost:6446` (the executor's throwaway script is
superseded by this session). Screenshots:
`/tmp/claude-1000/-home-matt-Development-helio/ee73f684-1d91-4333-a409-bc3d96f8ee84/scratchpad/hel1014-eval-shots/`
(`hel1014-eval-dark-rest.png`, `-dark-hover.png`, `-dark-menu.png`, `-light.png`, `-middrag.png`).

Mechanism confirmed live in Chromium (1440x900):
`.panel-list__zoom-container` inline width `"100%"` -> `getComputedStyle().width === "1152px"`,
`.react-grid-layout` present, `.mobile-panel-stack` absent. The library is correct in a browser; jsdom was the
deviant environment. This is the single most load-bearing observation and it is now first-hand.

Panel-actions affordance under 2.2.4:

- Rendered as a real `<button>` with `aria-label="My chart panel actions"`, `aria-haspopup="menu"`, `tabIndex 0`.
- Box `{x:754, y:93, w:24, h:24}` — a 24x24 hit target, sitting immediately left of the drag handle
  `aria-label="Move My chart panel"` at `{x:786, y:93, w:24, h:24}`. Same row, same size, 8px apart, no overlap.
- Hover: background resolves to `rgb(35,32,25)` (visible treatment, not a no-op).
- Focus: `outline: 2px solid rgb(249,115,22)`, `outline-offset: 2px` — the app's standard focus ring.
- Keyboard: `Enter` opens the menu (`aria-expanded="true"`, items Rename/Customize/Duplicate/Delete);
  `Escape` closes it and **returns focus to the trigger** (verified `document.activeElement === trigger`).
- Stacking: `.actions-menu` ancestor `z-index: 4`, `position: relative`, `pointer-events: auto`; the drag handle is
  a sibling at `z-index: auto`. No pointer-events or z-order anomaly.
- Light theme (`helio-theme=light` + reload): identical geometry `{754,93,24,24}` and identical drag-handle
  geometry; only token colours differ. Both themes cohesive (see `-light.png`, `-dark-rest.png`).

Drag/resize (4-panel dashboard `HEL909-EVAL4-clobber`, dragged via the dedicated Move handle, not the actions
button): drag engages correctly — the item tracks the pointer (`{264,422}` -> `{324,722}`), `.react-grid-placeholder`
renders at `z-index: 2` beneath the dragging item at `z-index: 3`, and on release the placeholder is removed and the
layout settles cleanly with all 4 panel-actions buttons still present. Note: my synthetic drop landed back on the
origin cell (the placeholder never left it for that displacement), so my run demonstrates the drag machinery and the
correct stacking rather than a net repositioning; the executor's independent multi-panel run did show a net move
(`y:343 -> y:623`). Both agree the drag path is unregressed.

Breakpoints: 1440 and 1100 -> desktop grid, 4 actions buttons. 768 and 390 -> `MobilePanelStack`, 0 actions
buttons, no grid. That is the pre-existing, width-driven HEL-301 behaviour and it is unchanged by this fix.

Console: 0 errors across every flow exercised.

Guardrail observations (REPORTED, not fixed):
- **HEL-1006** — at 390x844 and at a 768 viewport there is still no panel-actions host in the mobile stack.
  Unchanged by this fix, neither worsened nor absorbed.
- **HEL-1023** — no overlap anomaly observed at the breakpoints exercised; the fix touches no breakpoint or
  collision logic. No conclusion drawn about HEL-1023 itself; it stays open.

Before/after caveat, stated plainly rather than glossed: I did **not** re-install 2.2.3 for my own baseline, because
doing so rewrites `frontend/package-lock.json` in the worktree and this role is read-only on code. The
2.2.3-vs-2.2.4 identity claim therefore rests on (a) the executor's captured baseline, and (b) a stronger structural
argument I verified directly: every attribute above (position within the header, 24x24 size, border-radius,
hover/focus tokens, menu contents, z-index 4) is produced by `PanelCard.tsx`/`ActionsMenu.tsx`/their CSS, all
byte-identical to `main`, and react-grid-layout contributes only the grid item's transform/size. A visual delta in
the affordance itself would require a change in files this diff does not touch. I judge this sufficient; it is not
a cohesion call requiring the owner's tiebreak.

## Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- The `getComputedStyle` shim is global: every element in every suite whose width is unresolved now reports
  `"1280px"`. The blast radius is measured (274/274 green) and the pass-through for explicit `px` widths keeps it
  narrow, but a future test that asserts on an *unset* width will get `1280px` rather than `""`. The header comment
  already explains the mechanism; a one-line note that "an unset width reads as 1280px, not empty" would make the
  trap greppable for whoever hits it.
- `jest.setup.ts`'s `getPropertyValue` branch resolves the native method via
  `Reflect.get(target, prop, receiver).call(target, property)`; `receiver` is the proxy, so the lookup goes through
  the proxy trap once more before `.call(target, ...)` re-binds it. Correct as written, just slightly indirect —
  `target.getPropertyValue.call(target, property)` would read more plainly.
- Delivery (task 5.2) must still put the "supersedes Dependabot #481, harness-only, no product code" statement in
  the PR body; `files-modified.md` has the wording ready.
