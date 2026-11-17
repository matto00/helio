## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/actions-menu-viewport-clipping/hel-1750`. HEAD at the time of review: 2e98eba9287d61a47957129f1f097ea039125d92. No implementation commits yet.
- **Root cause, re-probed live by me** (worktree dev server on 7182, 1280x400, rail `.context-list__body` scrolled to the end, ⋮ on the 6th and last row): trigger bottom 345, panel 353-518, innerHeight 400. `elementFromPoint` at each item's centre: Rename hit; Duplicate (centre 404.5), Share, Export and Delete missed. Panel parent is `BODY`. This matches the probe report. The cause is the one-shot `top = rect.bottom + 8` in `ActionsMenu.tsx` `handleToggle`, which has no vertical fit. It is not an overflow ancestor. AC2 is met by the planning evidence.
- **Code claims in design.md, checked against the tree:**
  - `usePortalPopover` already has an opt-in `place` path: `visibility` stays hidden until `placed`, placement re-runs on resize, and closing un-places. The hook does not apply `visibility` itself; the consumer has to (see `OutputSchemaDisclosure.tsx:80-81`).
  - The horizontal clamp only runs once `panelPos.right` is defined. The first `handleOpen()` with no `computePos` sets `{}`, and the clamp runs after `place`. D4's "no-op" claim holds.
  - `fitSelectPanel` matches D2's description.
  - Exactly 13 production `<ActionsMenu` call sites, the same list as D7.
  - No production call site passes `align="above"`. Only `ActionsMenu.test.tsx:148` does.
  - "No consumer of `place` in `shared/`" is true. There is a precedent in features: `features/pipelines/ui/outputSchemaPanelPlacement.ts`, which uses the same scrollHeight measurement and also accounts for `.bottom-nav`.
  - `--z-popover` is 100. `BottomNav.css` sits below it, so a menu that overlaps the bottom nav still hit-tests as the menu.
- **Phone surface, checked live at 390x844:** at phone width the dashboard list is the command-bar switcher plus `MobileNavSheet`, which is a `role="dialog"` div, not a native `<dialog>`. Its rows have **no ActionsMenu**, only a separate `Share` button (`MobileNavSheet.tsx:405-417`). The only ⋮ on that page is the command-bar "Dashboard actions" menu (2 items: Add panel, Refine with AI) at the top of the viewport.
- **Playwright config:** one `dev` project (`playwright.config.ts:165`). There is no phone project.
- **Existing ActionsMenu tests:** `ActionsMenu.test.tsx:140-155` asserts the anchoring mechanism. With `align` omitted: `top` set and `bottom` empty. With `align="above"`: **`bottom` set and `top` empty.**

### Verdict: REFUTE

The diagnosis, the approach (D1 shared component via `place`, D2 shared helper, D3 internal scroll) and the scope are sound. The design is close. Two things would leave the executor to guess, and one of them is likely to end in a weakened test.

### Change Requests

1. **The plan contradicts the existing `align="above"` unit test and does not say how to resolve it.**
   - **What the design says:** D1/D2 make `place` return `{top, maxHeight, right}`. The generalised helper, like `fitSelectPanel`, flips upward by computing a `top`.
   - **What breaks:** `ActionsMenu.test.tsx:148-155` asserts `style.bottom` is set and `style.top` is `""` for `align="above"`. Under the planned design that test fails in jsdom. With zero rects and `prefer: "above"`, the room above is negative, so the helper falls back to below and returns `top`.
   - **Why it matters:** D5 protects only the keyboard tests ("pass unmodified"), and the risks protect `selectPanelFit.test.ts`. Nothing says what happens to the HEL-719 align tests. An executor will hit this red and edit the test. That is a test change the plan never sanctioned.
   - **Required revision:** design.md and tasks.md must say explicitly what happens to `ActionsMenu.test.tsx:139-156`. Either:
     - (a) the anchoring contract changes deliberately: the tests are rewritten to assert the preferred-side behaviour, either through the pure helper or through a mocked trigger and panel rect, with the reason recorded; or
     - (b) `place` returns a `bottom` anchor for the "above" side, as `placeSchemaPanel` does, so the existing assertions still hold.

     Whichever is chosen, add a task line for it.

2. **The phone half of the e2e (D8, task 3.1) and the phone scenario in the spec name a target that does not exist.**
   - **What the design says:** D8 says "Repeated on the phone project / a 390px viewport via whatever surface shows the dashboard list there".
   - **What is actually there:**
     - There is no phone Playwright project.
     - At ≤768px the dashboard list (`MobileNavSheet`) has no ⋮ ActionsMenu at all. I confirmed this live.
     - The spec's "Trigger near the left edge on a phone" scenario names no trigger that actually sits near the left edge on a phone.
     - As written, the phone e2e cannot be built. The executor will invent a substitute, or quietly drop it.
   - **Required revision:** name the concrete phone-side check. Options include:
     - an in-test `setViewportSize` on a named ActionsMenu surface that exists at 390px, such as MobileStepSheet's or MobilePipelineHeader's ⋮, or the command-bar "Dashboard actions";
     - a touch-sized case, since `(pointer: coarse)` lifts items to 44px and makes the panel about 230px tall: a far more exposed shape on the rail itself;
     - a unit test of the helper for the horizontal left-edge scenario.

     Record in the plan that the ticket's "phone" AC for the *dashboard list* is satisfied because the phone list has no ⋮ menu (it uses a Share button). Then the final gate can trace that AC rather than find it silently skipped.

3. **"Not shown before it is placed" has no implementing task and no test.**
   - **What is missing:** the hook exposes `placed`, but it does not hide the panel. ActionsMenu must render `visibility: placed ? undefined : "hidden"`, the way `OutputSchemaDisclosure.tsx:81` does. It must also render `maxHeight: panelPos.maxHeight` in its inline style. Task 2.3 mentions maxHeight but not visibility. No task tests the spec requirement "Actions menu is not shown before it is placed".
   - **Required revision:** add both to task 2.3, plus a unit assertion that the panel carries `visibility: hidden` until placement has run. Placement runs in jsdom, so this is observable, for example by asserting on the style before the layout effect commits or by stubbing `place`.

### Non-blocking notes

- `.popover__panel` animates `popover-in`, a `translateY(-3px)` with an opacity fade. The e2e should take its rect and `elementFromPoint` readings after that animation ends (for example, wait on `getAnimations()` settling), or it will flake at the edges.
- In D2, "else the other side if it fits" is a behaviour change for Select. Today `fitSelectPanel` flips only when the room above is greater than the room below, which is a superset of "fits above when it doesn't fit below". The planned wrapper therefore keeps Select's outputs only if it reproduces that exact rule. `selectPanelFit.test.ts` staying unmodified is the right guard. Keep it.
- For an ActionsMenu outside a dialog on phone, consider whether to cap the room below at the `.bottom-nav` top, as `outputSchemaPanelPlacement.ts` does. The menu paints over the nav (z 100 vs below), so this is cosmetic, not a reachability defect.
- `align` is passed by no production call site. Keeping it is fine (self-approved in Planner Notes), but its doc comment in `ActionsMenu.tsx:24-34` ("no viewport-collision detection") becomes false after this change and must be updated.
