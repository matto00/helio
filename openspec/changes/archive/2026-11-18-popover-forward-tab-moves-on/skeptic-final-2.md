## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 391c45c3b5c659532cead7cc5e0987717e44dedc. Base resolved live with `resolve-review-base.sh` (main/origin): 108c04b7f71c110ba6a7f82d89f93c0c28de383c.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/actions-menu-forward-tab/HEL-1776`.
- **Diff scope:** `git diff 108c04b7f...HEAD --stat` shows 19 files. The code files are `usePortalPopover.ts`, `nextTabbableAfter.ts`, their tests, `ProvenanceTrigger.test.tsx`, `OutputSchemaDisclosure.test.tsx` and `e2e/hel1759-popover-keyboard-focus.spec.ts`. The rest are openspec artifacts. Nothing touches the dashboard shell or list, so there is no overlap with HEL-1773. The cycle-2 delta (`git diff cdd4a8ec9..HEAD -- frontend e2e`) is limited to the hook's tabbable check, `isTabbable` being exported, one comment, and the new OutputSchemaDisclosure tests.

#### Round-1 change request 1 (AC3 consumer review): resolved

- My own grep for hook consumers that attach `panelRef` (`grep -rn panelRef frontend/src --include=*.tsx`, excluding tests) found:
  - ActionsMenu `:148`
  - Select `:208`
  - DashboardAppearanceEditor `:224`
  - OutputSchemaDisclosure `:70`
  - ProvenancePopover, via `useProvenancePopoverHost.tsx:153` and `ProvenancePopover.tsx:47`
- UserMenu (`:80`) and MobileNavSheet (`:119`) use their own local `useRef`, not the hook's ref. IconButton has no panel. `outputSchemaPanelPlacement.ts` imports only a type. That is the complete list of `usePortalPopover` importers.
- `proposal.md` now lists OutputSchemaDisclosure as **changes**, with `:47,70` cited. `design.md` adds it to the Context consumer list and to D4. Each "no change" entry carries a line citation:
  - Select: `:203,241`
  - ProvenancePopover: `:103-125`
  - UserMenu: `:79-80`
  - IconButton: `:58`
- These all match my grep. The review now agrees with ground truth.

#### Round-1 change request 2 (pin OutputSchemaDisclosure with a test): resolved

- `OutputSchemaDisclosure.test.tsx` adds two tests:
  - **Forward Tab:** renders 40 fields between "before" and "after" buttons and focuses "Show all N", the last tabbable. It asserts that the keydown was prevented, the dialog is closed, focus is on "after", and the trigger is not focused.
  - **Shift+Tab:** off the first control (the filter input), it asserts the dialog is closed and the trigger is focused.
- Red evidence is in `.concertino/scratch/HEL-1776/mutations.log`, tagged "(HEL-1776 c2) panel listener removed". The forward test failed (`1 failed, 15 passed`) and was then restored.
- The Shift+Tab test pins behaviour that is unchanged, so it is green on main too. That fits its role as the counterpart. Reading the code, removing the backward refocus would leave focus on "before", which would fail its `trigger toHaveFocus` assertion.

#### Hook tidy (cycle 2)

- The "is there a later tabbable in the panel" test now uses the exported `isTabbable` (`tabIndex >= 0`, not disabled, not inside `[inert]`/`[hidden]`, visible) and `compareDocumentPosition` FOLLOWING. It replaces the old index lookup and the `panel!` non-null assertions.
- The new check is stricter than before: hidden or inert controls no longer count as "later". The browser skips them anyway, so this is a correctness improvement and changes no consumer's visible behaviour.
- `jsdom`'s fallback in `isVisible` relies on computed style, so the unit tests still exercise the "has later tabbable" branch. The hook test "a non-last element keeps the panel open" is green.

#### ACs

- **AC1 (forward Tab off the actions menu closes it and moves on; e2e red first): met.**
  - Red: `red-e2e.log` from round 1. I re-verified this in round 1 and the cycle-2 diff does not touch the e2e oracle.
  - Green: my run of the full `hel1759-popover-keyboard-focus`, `hel1003-actions-menu-keyboard-reach` and `hel1756-popover-viewport-fit` specs gave **38 passed, 6 skipped, exit 0**. Settings: `--project=dev --workers=2`, lane DB `helio_hel1776`, DEV_PORT 7208. The 6 skips are the phone appearance-editor cases (`PHONE_EDITOR_REASON`). Log: `.concertino/scratch/HEL-1776/skeptic2-e2e.log`.
- **AC2 (Shift+Tab unchanged): met.**
  - The panel listener returns early on `shiftKey`.
  - The focusout path refocuses the trigger only on `viaTab === "backward"` from inside the panel.
  - The existing hel1759 Shift+Tab e2e cases pass in the run above, as do the unit tests and the new OutputSchemaDisclosure Shift+Tab test.
- **AC3 (say which popovers change): met.** ActionsMenu, DashboardAppearanceEditor and OutputSchemaDisclosure change. Select, ProvenancePopover, UserMenu and IconButton do not. This matches the grep above.
- **AC4 (full hel1759 spec passes): met**, in the same run.

#### Gates and wider checks

- **Jest:** `npm --prefix frontend test -- --maxWorkers=3 --testPathPatterns='usePortalPopover|nextTabbableAfter|ProvenanceTrigger|ActionsMenu|Select|OutputSchemaDisclosure|DashboardAppearanceEditor|UserMenu|IconButton'` gave **24 suites, 237 tests passed**, exit 0. Log: `skeptic2-jest.log`.
- **Lint, typecheck and format:** `npm --prefix frontend run lint` (max-warnings 0), `npm --prefix frontend run typecheck`, and prettier `--check` on the changed hook, test and e2e files all exit 0.
- **e2e grep for altered behaviour:** I grepped `e2e/` for specs that press Tab near the affected popovers. Besides hel1759, hel1003 and hel1756, these turned up: hel1085, hel1090, hel1088, hel1080, hel510 and hel1579.
  - The only plausible interaction is a Select being tabbed past in hel1085 and hel1090. Select's real focus stays on its trigger, which is outside the panel, so it is unaffected by the new code.
  - I ran both anyway: **6 passed**, exit 0 (`skeptic2-e2e-extra.log`).
  - The others do not involve a hook-driven popover panel.
- **Servers:** started with `start-servers.sh`, `assert-phase.sh servers` printed `PASS servers`, and I stopped them with `stop-servers.sh` (`STOPPED ports=7208,10115`). The e2e specs deleted their own throwaway users.
- **UI/design judgment:** nothing visual changed (no CSS, markup or token changes), so no screenshots apply. The behaviour change is keyboard focus only, and the browser and unit runs above verify it.

### Verdict: CONFIRM

### Non-blocking notes

- `proposal.md`'s last What-Changes bullet, "OutputSchemaDisclosure.test.tsx pins the disclosure that fail on main first", is garbled. Only the forward-Tab test is red-first; the Shift+Tab test pins unchanged behaviour. The PR body should say it plainly.
- I accept the round-1 notes on mutations 2.4(ii) and 2.4(v) unchanged.
