## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 36735a24aef109328a3c1909ecb63721cc5fa2ff. The change dir is still untracked, so the plan has no commits yet.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/popover-viewport-fit/hel-1756`.
- **Round-1 change requests are addressed in the artifacts:**
  - CR1 (focus on open) is now D6, with a real-browser proof (C9 and task 2.5) and a spec requirement.
  - CR2 (re-fit on growth) is now D7. It names the mechanism: an additive `reposition()` plus a ResizeObserver on an inner, uncapped content element. It forbids a synthetic resize (C10). The proposal no longer contradicts it. I checked the mechanism against `usePortalPopover.ts:173-190`: today `run()` is reachable only through `[isOpen, opted]` and window `resize`, so a new return value really is required. Natural height `scrollHeight + (offsetHeight - clientHeight)` does grow while the panel is capped. An observer on an uncapped inner element does fire when content arrives, and changing the panel's `maxHeight` does not resize that element, so there is no feedback loop.
  - CR3 (provenance cap, width and refs) is now D8. The cap `min(0.7*innerHeight, 480)` matches `ProvenancePopover.css` (`max-height: min(70vh, 480px)`). The width and left clamp are kept. Provenance merges its refs. UserMenu replaces its local ref (`UserMenu.tsx:80`). The doc comment at `ProvenancePopover.tsx:31-35` is updated.
  - CR4 is partly addressed. D9 scopes the overflow rule away from `.popover__panel`. The spec names "Save dashboard style" (`DashboardAppearanceEditor.tsx:260-266`).
- **Fit math still matches today's placement on the preferred side** (`panelFit.ts:33-50`):
  - UserMenu `nav` gives `bottom = innerHeight - rect.top + 8`.
  - UserMenu `rail` option (a) gives `bottom = innerHeight - rect.bottom`.
  - Provenance below gives `top = rect.bottom + 8`.
- **Mount order works for provenance.** `handleOpen` sets `panelPos` and `isOpen` together, so the portal mounts in the same commit. The child's merged ref is attached before the parent hook's placement layout effect runs.
- **Hook horizontal clamp.** The clamp at `usePortalPopover.ts:130-165` already handles `right`-anchored panels once `panelRef` is attached. A left-anchored panel (UserMenu `rail`) needs the local clamp that D2 specifies.
- **D5 mutation target exists.** `DashboardList.css:9-13` holds `position: relative`. The existing guard hovers `nth(4)` (`e2e/hel1750-actions-menu-viewport-fit.spec.ts:123`).
- **New ground-truth findings** (they drive the REFUTE):
  - `frontend/src/app/App.css:477-480` sits inside `@media (max-width: 768px)`, which opens at line 400; no top-level `}` falls between lines 400 and 480. It sets `.dashboard-appearance-editor { display: none; }`. The comment says dashboard appearance editing is out of scope on phone (mobile-pwa-handoff.md §2).
  - `DashboardAppearanceEditor.tsx:275` already puts the class `dashboard-appearance-editor` on the trigger's wrapper `<div className="popover dashboard-appearance-editor">`.
  - `DashboardAppearanceEditor.css:1-3` gives that class `z-index: 4`.
  - `dashboardChrome.ts`: the phone shell never uses the meta row; it uses CommandBar, whose editor instance is hidden by the rule above.

### Verdict: REFUTE

### Change Requests

1. **The spec requires a phone scenario that cannot be run: the appearance editor does not exist on phone.**
   - At widths up to 768px, `App.css:477-480` hides `.dashboard-appearance-editor`, which is the editor's trigger wrapper. At 390 wide no instance is openable, from either CommandBar or DashboardMetaRow. This is a deliberate product rule (no editing on phone).
   - The plan still requires the scenario:
     - `specs/popover-viewport-fit/spec.md`, requirement "Dashboard appearance editor keeps every control reachable", scenario "Short phone window".
     - D4: "one test per fixed popover per viewport class (desktop short, phone short)".
     - D10 and task 1.3 imply a visible instance at every probed size.
   - As written, the executor must do one of two wrong things: write an e2e that cannot open the editor, or un-hide the editor on phone (scope drift against a product rule).
   - **Required:**
     - Remove the editor's phone scenario, or replace it with one that states the editor is not rendered at widths up to 768px, citing `App.css:477`.
     - Make D4 and D10 say the editor is desktop-only: its probe and e2e cover the desktop short windows only, and probes.md records phone as "not rendered".
     - Keep the phone probe and e2e for UserMenu (BottomNav `nav`) and provenance (mobile stack header).

2. **D9's suggested class for the editor's form would break the panel.**
   - D9 proposes "`.dashboard-appearance-editor` added beside `popover__panel`" as the scoped class for the overflow rule. That class already belongs to the trigger wrapper. Putting it on the portalled `<form>` would bring two existing rules with it:
     - `z-index: 4` (`DashboardAppearanceEditor.css:2`). Selector specificity ties with `.popover__panel`'s `z-index: var(--z-popover)` (100), so whichever stylesheet loads later wins. If the editor's own stylesheet loads later, the form drops below `.popover__scrim`, and clicks would land on the scrim and close the editor.
     - `display: none` at widths up to 768px (`App.css:477`), which would hide the panel itself.
   - **Required:** name a new, unused class for the form, for example `.dashboard-appearance-editor__panel`. State that it must not reuse `.dashboard-appearance-editor`. Mirror the change in task 2.2.

### Non-blocking notes

- **UserMenu has no growth path.** Its items are static. D7's "each converted consumer wraps its content in an inner element and observes it" is unnecessary there. If a wrapper is added inside `role="menu"`, keep it a plain generic element so `handleMenuKeyDown`'s `querySelectorAll("button")` and the menu's owned-item semantics are unchanged. Better, state that UserMenu skips the observer.
- **Provenance inner wrapper.** `.provenance-popover` is a flex column with `gap: var(--space-3)` between its direct children. Wrapping the header and content in one inner element moves that gap, so the wrapper must take over the column layout and the gap. Otherwise spacing changes, which the final gate would catch visually.
- **Task numbering.** Tasks run 2.1, 2.0, 2.2, 2.3, 2.5, 2.4. The intended order is readable, but renumber them so the red-first e2e (2.1) clearly comes before the fix.
- **Provenance inside a native `<dialog>`.** It still positions in window coordinates. That was true before this change too, so it is not a regression; if the probe shows an offset inside a modal, record it in probes.md.
- **Focus-out close.** Attaching the hook's `panelRef` to the editor form: native colour-picker popups and disabling the focused submit button produce focusout with `relatedTarget` null, which the hook ignores (`usePortalPopover.ts:99`). D3's test should still cover a colour-input click in a real browser.
