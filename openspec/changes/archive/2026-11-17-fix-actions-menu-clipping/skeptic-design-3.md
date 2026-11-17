## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/actions-menu-viewport-clipping/hel-1750`. HEAD is 2e98eba9287d61a47957129f1f097ea039125d92. The only untracked path is the change dir, so there is no implementation yet.

- **Round-2 CR1 (phone e2e surface did not exist): addressed.**
  - D8's phone bullet now targets the pipeline spine's Output ⋮ (`SpineOutputs`, "Output actions for <name>"), with `SpineStepRow` as a named alternative. Round 2 confirmed both live at 390x844.
  - The spec scenario is renamed "Pipeline Output menu near the bottom of a phone viewport", and its WHEN clause matches. Task 3.1 matches too.
  - The fallback clause that implied a panel-card surface is gone.
  - The absence of a phone ⋮ is now recorded in D8 and task 3.2:
    - `MobilePanelStack` renders no `PanelCardHeader`.
    - `MobileNavSheet` has no ⋮. I re-checked: `MobileNavSheet.tsx` mentions ActionsMenu only in a comment at line 406, and its rows carry a separate Share button.
  - The final gate can trace both.

- **Round-2 note 1 adopted:** the D2 no-layout rule is now keyed on `panel.scrollHeight === 0`, as in `Select.tsx`.

- **Round-2 note 2 adopted:** D9 specifies a focus spy that records `style.visibility` at the moment of the call, and a pre-placement observation through a ref callback or a mocked hook.

- **Round-1 CR1 and CR3 still hold:**
  - D2a keeps the top/bottom anchoring contract, and the HEL-719 tests stay unmodified.
  - Task 2.3 renders `visibility` and `maxHeight` inline.
  - D5 and task 2.5 move focus so it runs once the menu is placed.

- **Fresh review:**
  - **Call sites:** a grep of `<ActionsMenu` in production `.tsx` files (tests excluded) counts 13, matching D7's list.
  - **Hook:** `usePortalPopover.ts` has opt-in `place` (lines 58-65 and 173-181), and `placed` is always true without `place` (line 214).
  - **Current code:** `ActionsMenu.tsx:56-64` focuses on `[isOpen]`, and `:72-78` is the one-shot `computePos`. Both match the Context section.
  - **Coverage:** every ticket AC maps to a task:
    - the probe maps to 1.1;
    - the e2e red-first maps to 1.2 and 3.1;
    - the call-site audit maps to 3.2;
    - desktop/phone and light/dark map to 3.3.
  - **Placeholders:** none. No TBD or deferred blocking decision.

### Verdict: CONFIRM

### Non-blocking notes

1. **"Each new unit test is shown red against the unfixed code" (D9, task 2.4) cannot be literally true for two of the tests.** The executor should label these honestly rather than fudge a red.
   - **Focus test.** Today's ActionsMenu never sets `visibility: hidden`, so a spy that checks visibility at `focus()` passes on today's code.
     - Its meaningful red is against the intermediate state: visibility hidden added (task 2.3), focus still on `[isOpen]`.
     - D9's phrase "red against today's `[isOpen]` ordering" means that state. Record the red there.
   - **Left-edge test.** `usePortalPopover.ts` (lines 131-165) already clamps right-anchored panels off the left edge when the rect is non-zero. With mocked rects, the left-edge test may already pass on today's code.
     - If it does, label it a guard.
     - Show that it can fail by mutation, for example by removing the clamp in the new `place`, rather than claiming a red against unfixed code.
2. **Hook clamp after `place`.** The hook's clamp effect re-runs whenever `panelPos` changes. D4 says that run is a no-op because `place` already clamps. The executor should confirm it does not double-shift a capped or above-anchored panel, since the clamp only touches `right`. The unit test from note 1 covers this if it uses mocked rects.
3. **SpineOutputs on phone.** Round 2 measured Output trigger tops at 787 and 877 with `.bottom-nav` at 776. The second trigger is under the nav, so the e2e must scroll it clear before clicking. D8 says this; keep it.
