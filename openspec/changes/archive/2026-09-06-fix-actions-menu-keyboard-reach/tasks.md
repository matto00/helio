# Tasks

## 1. Verify the measurement rig before trusting it (D0d — binding)

- [x] 1.1 Confirm server freshness **functionally**, not by health probe
      (CON-155): make a visible, uniquely-identifiable change to a served
      asset, confirm it appears in the browser, revert it. Do not proceed on
      "already healthy … reusing".
- [x] 1.2 **Negative control, before any measurement is trusted.** Point the
      probe at a case known to fail — a surface with no `ActionsMenu` — and
      confirm it reports "not found". A probe that has never returned the
      negative result has not been shown capable of it. Record the output.
- [x] 1.3 Confirm the probe asserts the element it marks is actually rendered.
      A predicate that cannot return false (e.g. `... || true`) is forbidden;
      see D0c instance 2.
- [x] 1.4 Re-confirm the desktop baseline: at 1440 the row kebab is reached by
      Tab, Enter opens the menu, Escape restores focus, and `.focus()` on the
      **resting** trigger currently lands on `<body>` (the defect).

## 2. Fix (a) — trigger focusable at rest, still painted on reveal (D1)

- [x] 2.1 In **`DashboardList.css`** (host CSS, not `ActionsMenu.tsx` — D6),
      replace the row kebab's resting `display: none` with the visually-hidden
      declarations from D1: `position: absolute`, 1x1, `margin: -1px`,
      `overflow: hidden`, `clip: rect(0,0,0,0)`.
- [x] 2.2 Add a comment naming **`theme.css:340`** as the canonical source of
      this recipe, and stating why the `.sr-only` class itself is not used here
      (it is a markup class; the wrapper at `ActionsMenu.tsx:152` takes no
      `className`; and hidden-at-rest vs painted-on-reveal is a CSS state).
      Mirror the idiom in `AgentMemoryList.css`.
- [x] 2.3 Confirm the treatment is **not** `display: none`,
      `visibility: hidden`, `content-visibility: hidden`, or an `inert`
      ancestor.
- [x] 2.4 **Extend the reveal rule (`DashboardList.css:243-248`) to undo EVERY
      declaration added in 2.1** — `position`, `width`, `height`, `margin`,
      `overflow`, `clip` — not just `display`. **This is the step whose
      omission produces a green-but-broken result** (measured: kebab never
      painted again, yet every other criterion and both guard arms pass).
- [x] 2.5 Verify in a real browser at desktop width that `.focus()` on the
      **resting** trigger lands on the trigger, not `<body>`.
- [x] 2.6 **Resting geometry unchanged:** `flex: 1` row button measures 215px
      before and after.
- [x] 2.7 **Painted-on-reveal, both triggers:** on `:hover` AND on
      `:focus-within`, assert wrapper **`position: relative`** (the
      `Popover.css:1-3` baseline — NOT `static`, which correct code never
      produces), **`clip: auto`**, the revealed wrapper's rendered **height is
      not 1px** (a reveal that omits the `height` reset passes every other
      check here while painting into a 1px-tall box — measured in round 5),
      and that the row button reflows to **187px**. Do not accept "focus works" as evidence the kebab is visible —
      it is not.
- [x] 2.8 Additionally assert the trigger's rendered rect is **24x24** on
      reveal. This DOES discriminate (measured: 24x24 revealed vs **3x24** in
      the broken state, where the 1px wrapper shrinks the flex item). An
      earlier revision forbade this check on a fabricated claim; see design.md
      D1.

## 3. Confirm no desktop regression

- [x] 3.1 Kebab reached by Tab; Enter opens with focus on the first item;
      ArrowUp/ArrowDown/Home/End navigate; Escape restores focus to trigger.
- [x] 3.2 Confirm the other `ActionsMenu` consumers are unaffected
      (`PanelCard`, `SidebarItemList`, `CommandBar`, `PipelineDetailHeader`) —
      D6 blast radius.
- [x] 3.3 Confirm nothing changed at phone width: the sidebar remains
      `display: none` at <=768px. **Do not un-hide it.**

## 4. Focus-trap verification — CONDITIONAL, expected to be N/A (D3)

- [x] 4.1 **First, determine whether this change touches any focus-trapped
      surface at all.** Under the narrowed scope it almost certainly does not:
      the fix is a CSS treatment on a sidebar row, and `MobileNavSheet`'s trap
      is explicitly out of scope (D2). **If no trapped surface is touched,
      record "N/A — no trapped surface modified" with the file list as
      evidence and skip 4.2/4.3.**
- [x] 4.2 **Do NOT manufacture a trap change in order to have something to
      verify here.** An N/A exit is the expected and correct outcome. Widening
      the diff to satisfy a checklist item is a defect, not diligence.
- [x] 4.3 Only if 4.1 finds a trapped surface genuinely touched: walk the
      **full cycle** (N+1 tabs from the first element, every stop asserted
      inside the panel, walk returns to start), **with the actions menu both
      open and closed**. Two boundary presses are NOT sufficient (D3 leak
      modes i-iii).
- [x] 4.4 Do **not** modify `MobileNavSheet`'s focus trap under any
      circumstances (D2 — its current behaviour is correct).

## 5. Regression guard — Playwright, both arms, fixed assertion shape (D4)

- [x] 5.1 Write the guard **fresh** in `e2e/`. The three scratch probes are
      deleted and must not be revived in any form.
- [x] 5.2 Locate the trigger by a **unique marker**, never a bare
      `.actions-menu__trigger` class selector (D0b), and assert the marked
      element is rendered before walking (D0c).
- [x] 5.3 Assert the **programmatic-focus** property: call `.focus()` on the
      **resting** (unhovered, unfocused-within) row trigger at desktop width
      and assert `document.activeElement` is that trigger.
      **Do NOT use tab-reachability as the discriminating assertion** — it is
      green both before and after the fix (measured: kebab reached at index 15
      pre-fix, because `:focus-within` reveals the wrapper once the row button
      has focus) and therefore discriminates nothing. See D4.
- [x] 5.4 **Red arm:** revert the fix; confirm the guard fails with the
      sentinel **`document.activeElement === document.body`**. Record the
      actual `activeElement` tag/class in the output, not just pass/fail.
      Forbidden as substitutes: `toBeVisible`, `toHaveCount`,
      `toBeInTheDocument`, snapshot diffs, any element-presence assertion, and
      any tab-reachability assertion.
- [x] 5.5 **Green arm:** with the guard removed and the defect present, confirm
      the rest of CI passes — proving nothing else already catches this.
- [x] 5.6 Confirm the failure isolates to this guard — a red arriving from lint
      or typecheck before the guard runs proves only that those gates work.
- [x] 5.7 Demonstrate stability across repeated runs (HEL-991/HEL-992 flake
      neighbourhood).

## 6. Triage the 12 in-scope jsdom assertions (D5)

- [x] 6.1 `ActionsMenu.test.tsx` (6): per-assertion, keep as genuinely
      falsifiable or annotate with what it cannot prove. Reasoning per
      instance, not blanket.
- [x] 6.2 `MobileNavSheet.test.tsx` (6): same treatment.
- [x] 6.3 Do not touch the 27 assertions in the 9 files owned by HEL-1005.

## 7. Housekeeping

- [x] 7.1 Confirm `e2e/hel1003-premise-probe*.spec.ts` are absent (already
      deleted; must not reappear).
- [x] 7.2 Run the full gate chain: `npm run lint`, `npm run typecheck`,
      `npm test`, `npm run format:check`.
- [x] 7.3 Confirm no migration was added (main is at V102) and no
      already-applied migration was edited.
- [x] 7.4 Confirm no files owned by concurrent runs were touched — HEL-973
      (`PipelineStepRepository`, pipelines schema) and HEL-845 (Connectors /
      REST source).
