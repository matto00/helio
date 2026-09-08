## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is derived from a command I ran or an image I looked at in this
session. The executor's and evaluator's reports were read only as claims to test.

### What I verified (with evidence)

**A. The diff is what it claims to be.**
`git diff origin/main..HEAD --stat` on 9ed35f7b: 3 product-tree files (`frontend/package-lock.json`
+6/-3, `frontend/src/test/jest.setup.ts` +55, and the two new guard suites), the rest OpenSpec
artifacts. `frontend/package.json` does not appear in the diff at all, and the lockfile diff is
exactly the 3 lines `version`/`resolved`/`integrity` on `node_modules/react-grid-layout` at 2.2.4.
That is task 4.2a's required shape, verified independently — the drift class that already bit this
change once is not present. `node -p require('react-grid-layout/package.json').version` = `2.2.4`;
range in `package.json` is still `^2.2.2`.

**B. The root-cause framing is correct — confirmed at source, not from the changelog.**
`node_modules/react-grid-layout/dist/chunk-BMN6M2VL.js:8` contains verbatim:
`const style = typeof globalThis.getComputedStyle === "function" ? globalThis.getComputedStyle(node) : null;`
then `const computed = Number.parseFloat(style.width); if (Number.isFinite(computed)) return Math.max(0, computed);`
— the `clientWidth` fallback is genuinely unreachable when a percentage width parses finite, exactly
as design-gate round 1 corrected. The shim replaces `globalThis.getComputedStyle`, which is the same
binding the library reads. Right primitive.

**C. Attention point 1 — the "identical to 2.2.3" inference, closed EXHAUSTIVELY rather than by
sampling.** Instead of reinstalling 2.2.3 (which churns the lockfile), I obtained both published
tarballs and diffed them content-wise, order- and chunk-hash-normalized:

```
$ npm pack react-grid-layout@2.2.3 && npm pack react-grid-layout@2.2.4   # extracted to a/ and b/
$ diff -rq a/package/css b/package/css
(no output)  ->  CSS_IDENTICAL
$ diff <(normalize a/package/dist/*.js) <(normalize b/package/dist/*.js)
```

The **entire** semantic delta of 2.2.3 -> 2.2.4 is three things:
1. `getContentWidth()` added; `useContainerWidth` reads it instead of `node.offsetWidth`.
2. Measured widths are now `Math.round(...)`ed, and `setWidth` bails out when unchanged.
3. `e: e.nativeEvent ?? e` in the resize callback (upstream #2264 — previously handed consumers
   `undefined`).

Nothing else. **The stylesheet is byte-identical, and no layout/geometry math changed.** This is a
stronger result than a screenshot A/B, which can only sample states: there is no code path by which
2.2.4 could move, resize or restyle the panel-actions button relative to 2.2.3. The only real-browser
behavioural deltas are a sub-pixel rounding of container width and a resize event that is now defined
rather than `undefined`. The executor's inference is sound, and the hole the orchestrator asked about
does not exist.

**D. Attention point 2 — the 734 vs 754 bounding-box discrepancy is fully explained and benign.**
I reproduced *both* readings in one session by changing only the viewport:

```
viewport 1440 -> btn {x:754, y:93, w:24, h:24}  cardWidth 567  insetFromCardRight 53
viewport 1400 -> btn {x:734, y:93, w:24, h:24}  cardWidth 547  insetFromCardRight 53
```

Same y, same 24x24 size, and an **invariant 53px inset from the card's right edge** in both. The 20px
difference is the grid container being 40px narrower at a 1400px viewport (two columns, so half of
that per card). It is not a position shift within the card. (The 53px inset is itself accounted for:
the drag handle sits to the right at x+32, 24px wide, then 21px trailing padding.)

**E. Attention point 3 — the guards are not vacuous, re-proven by my own mutation.**
`widthMeasurementShim.test.tsx` asserts, before its real assertion,
`expect((zoomContainer as HTMLElement).style.width).toMatch(/%$/)` — i.e. it verifies the measured
node genuinely carries an inline PERCENTAGE width. It renders the real `PanelList` and the real,
unmocked `useContainerWidth`; only `PanelGrid` is mocked to capture the `width` prop. This is exactly
the shape design-gate round 1 demanded, and a bare `div` is not used anywhere.

Baseline green, then I neutered the shim myself (`if (typeof globalThis.getComputedStyle === "function")`
-> `if (false)`) and re-ran:

```
$ npx jest src/test/widthMeasurementShim.test.tsx src/test/panelActionsAccessibleName.test.tsx src/app/App.test.tsx
    Expected: >= 768
    Received:    100
    Unable to find role="button" and name `/panel actions/`
    TestingLibraryElementError: ... role "button" and name "Move CPU Usage panel"
    Unable to find role="button" and name "Revenue Pulse panel actions"
Test Suites: 3 failed, 3 total
Tests:       4 failed, 27 passed, 31 total
```

Both new guards AND the original unmodified `App.test.tsx:893` assertions go RED together. Restored;
`git diff --stat` clean afterwards. The accessible-name guard's RED is a genuine
`getByRole`-by-accessible-name miss through the real unmocked `PanelCard`/`ActionsMenu` tree, so it
is failable in the shape the ticket requires.

**F. Attention point 4 — blast radius, measured rather than assumed.**
The shim is loaded only via `jest.config.cjs:5 setupFilesAfterEnv`; it is in no production build input.
Every `getComputedStyle` consumer in `src/` is: `chartAppearance.ts:46` (reads custom properties via
`getPropertyValue("--app-*")`) and `OnboardingChecklist.test.tsx:384/404` (reads
`getPropertyValue("background"/"color")`). All three go through the proxy's passthrough branch, and
those tests pass — so the method-forwarding arm is actually exercised, not dead. I also grepped the
third-party deps that run under jest (`echarts`, `react-draggable`, `@testing-library`, `@floating-ui`,
`react-dom`, `react-resizable`) for `getComputedStyle(...).width` reads: **zero hits**. The only
consumer of the shimmed `width` in the whole tree is react-grid-layout itself, which is the intended
target. `display`/`visibility`/anything else is untouched by the proxy, so testing-library's
visibility logic is unaffected.

**G. Real-browser verification — my own, on the running dev server (DEV_PORT 6446).**
`start-servers.sh` + reuse: `READY backend`, `READY frontend`. At 1440x900, desktop branch:

```
zoomInlineWidth:   "100%"        <- what jsdom returns verbatim
zoomComputedWidth: "1152px"      <- what a REAL browser returns (used value)
btnName: "My chart panel actions"   btnRect: {x:754,y:93,w:24,h:24}
gridWidth: 1152    gridItem width: 567px
hitTestElementIsInsideButton: true   (elementFromPoint at the button's centre is its own icon span)
```

This is the ticket's central claim reproduced first-hand: the same node reports `"100%"` in jsdom and
`"1152px"` in Chromium. jsdom is the deviant environment; 2.2.4 is correct.

- **Focus treatment:** `outline: rgb(249, 115, 22) solid 2px`, `outline-offset: 2px` — the standard
  accent focus ring, matching sibling controls. Keyboard `Enter` opens the menu with the first item
  focused and `Delete` in the danger color (screenshot `page-2026-09-08T05-55-15-701Z.png`).
- **Stacking vs. the drag handle:** the two 24x24 controls sit side by side (actions at x=754, "Move
  ... panel" at x=786), 8px apart, vertically centred on the title. No overlap, no z-index games
  (`z-index: auto`), and the hit test lands inside the actions button.
- **Both themes, looked at, not inferred:** dark (`element-2026-09-08T05-55-05-249Z.png`) and light
  (`element-2026-09-08T05-55-33-515Z.png`). Position, size, iconography, hover pill and contrast are
  at parity; the light capture is legible and consistent with sibling surfaces. Nothing off-pattern —
  this is the same shared `ActionsMenu` affordance used elsewhere in the app, unmodified.
- **Console:** 0 errors, 0 warnings for the session.
- **Drag and resize unregressed** (the path 2.2.4's third delta touches): resize 567x262 -> 801x332,
  drag `matrix(1,0,0,1,0,0)` -> `matrix(1,0,0,1,351,70)`, zero JS errors in both. I restored the
  dashboard to its original geometry via the app's own Undo afterwards (verified back at
  `transform: matrix(1,0,0,1,0,0)`, `width: 567px`).

**H. Acceptance criteria traced.**
1. *Mechanism named and demonstrated, not inferred from the changelog* — MET: (B) at library source,
   (G) by live measurement of `"100%"` vs `"1152px"` on the actual observed node.
2. *If a product regression, button reachable and original assertion unmodified* — N/A by evidence:
   it is not a product regression. (C) proves 2.2.4 changed no styling or geometry code; (G) proves
   the button renders correctly under 2.2.4 in a real browser with no product change. The
   harness-only framing is right, and I tested it rather than accepting it.
3. *Any test change justified against explanations 1-3* — MET: `App.test.tsx` is untouched
   (`git diff origin/main..HEAD -- frontend/src/app/App.test.tsx` empty; not in the diff stat), so the
   query was not weakened — the HEL-1003 rule is honoured.
4. *Mutation-proven guard goes red when the accessible name is removed* — MET, reproduced by me in (E).
5. *Verified in a real browser* — MET, by me in (G).
6. *PR body states whether this blocks Dependabot #481* — NOT YET; it is task 5.2, still open, and the
   content is pre-drafted in `files-modified.md:290`. This is a delivery step the orchestrator
   performs after this gate, not a defect in the work under review. See non-blocking note 2.

**I. Guardrails.** `PanelGrid.tsx`, `PanelCard.tsx`, `ActionsMenu.tsx` are absent from the diff
entirely, so HEL-1023 and HEL-1006 are untouched by construction, and no table-panel component is in
the diff (no collision with the concurrent lane). Both interactions are reported and not fixed, as
required.

### Verdict: CONFIRM

The change ships. The harness-only framing survived every attempt I made to break it: the exhaustive
tarball diff shows 2.2.3 -> 2.2.4 has byte-identical CSS and no geometry math, the live browser
reproduces the exact jsdom-vs-browser divergence the fix is built on, both guards go RED under my own
mutation together with the original untouched assertion, the shim's blast radius is zero by direct
grep rather than by assumption, and the panel-actions affordance is visually and behaviourally
identical to its pre-2.2.4 state in both themes with drag and resize working.

### Non-blocking notes

1. `openspec/changes/restore-panel-actions-rgl-224/evaluation-1.md` is untracked (`git status`:
   `?? ...evaluation-1.md`) while every sibling report is committed. Worth sweeping into the delivery
   commit so the evidence trail is complete in the PR.
2. Ticket AC 6 is discharged by task 5.2 (PR body) and task 5.1 (rebase + re-run), both still open.
   Neither is a defect in the reviewed diff, but AC 6 is a real, ticket-level acceptance criterion —
   the PR body must state that this **supersedes** #481 (not merely "does not block" it) and that the
   fix is harness-only with no product code changed. `files-modified.md:290` already has the wording.
3. The shim reports `"1280px"` for *any* element whose computed width is unresolved, not just the one
   node react-grid-layout measures. Measured collateral today is zero (F), and the outcome-based
   design is deliberately correct per design D2 — but if a future test ever needs to assert an
   unresolved width, it will have to set an explicit `px` value to opt out. The comment at
   `jest.setup.ts` explains the mechanism well; a one-line mention of that opt-out would make the
   escape hatch discoverable.
