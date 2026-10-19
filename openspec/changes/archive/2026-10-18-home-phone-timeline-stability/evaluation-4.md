## Evaluation Report — Cycle 6 (evaluation-4.md)

Cold evaluation of pushed HEAD `9e3c9893712d0f7cebe955c6feb19cae48084e9d` (PR #1068). The diff base was resolved live
with `resolve-review-base.sh`: `069afd36d` (origin/main). The spawn guard returned `READY`.

### Phase 1: Spec Review — PASS

- **AC1 (0px load shift).** Addressed. 32 held-load cases (8 viewports × 2 themes × 2 orders) plus 4 type-style cases
  (Mono and Serif at 1280×900 and 375×667) all measured `runsTopSpread`, `contentTopSpread` and `shelfTopSpread` = 0
  in my run. The bound case (a 3-line sentence moves by one line only) passes.
- **AC2 (as relaxed by owner ruling C3).** Addressed. Guard at 375×667, light and dark: heading bottom 514.8, first-row
  top 563.8, nav top 599, scrollTop 0. It is labelled a GUARD, not fails-first, and the mutation red is in
  `e2e-evidence/HEL-1665/cycle6/guard-mutation-one-column-shelf-red.txt`.
- **AC3 (fails first).** The shift tests were red on base (`red-final/red-run-unmodified-code.txt`). The new Mono
  case is red on e1b5c1046: `scratch/HEL-1665/cycle8/red-on-e1b5c1046.txt` shows `mono 1280 runsTopSpread 30`,
  1 failed / 3 passed.
- **Constraints.**
  - C1 is honored: my run's 1280 settled boxes equal every pinned base number exactly, in both themes.
  - C3 is honored: the spec records the relaxed AC2, and no short-phone layout change was built.
  - C2 is retired.
- **Tasks.** 1.1–3.6 are done. 3.7 is the PR/merge disposition and is correctly still open.
- **Scope.** The diff touches only Home UI files, the hel1665 e2e and its probe, DESIGN.md's Home entry, the home-page
  spec and the archived change dir.
- **Merges are clean.** `git show --remerge-diff` is empty for d0865a84d and 9e3c98937. a06999320 was squashed away
  and is not an ancestor of HEAD.
- **Planning artifacts.**
  - design.md's cycle-8 note matches the code.
  - Both spec copies disclose the cold-load fallback-font residual as recorded, not asserted, which is what the owner
    approved (escalation `-a26436`, option b).

### Phase 2: Code Review — FAIL

**Gates, re-run by me on 9e3c98937** (`nice -n 19`, 2 workers, under the lock). Logs are in
`/home/matt/Development/helio/.concertino/scratch/HEL-1665/eval4/`.

- `npm run lint`, `format:check`, `typecheck` and `check:e2e-types` all exit 0.
- `npm test`: root 524/524 and frontend 9172/9172.
- `npm --prefix frontend run build` exits 0.
- e2e on the canonical servers 7097/10004 with `--trace retain-on-failure`: **89/89 passed** (`e2e.log`). The run
  covered hel1665 (including the Mono and Serif cases), hel1642, hel1572 (including :227, the ghost-class regression
  that c208eccc8 fixed), hel1583-home-375, hel1578-home-page and hel1578-home-changed-dot.
- The cold-load `fontSwapSpread` was recorded at 3–4px locally and is not asserted, as the owner ruled.

**Ghost/real line-count parity, measured independently.** In the live app I added a `.home-opening__loading >
.home-opening__ghost` copy beside the real sentence and switched `data-type-style` in the DOM only (no server write).
Ghost and real sentence had the same height at every width checked, in all three styles: 375, 540, 620, 700, 769,
1100 and 1440. Examples: 769 Sans/Serif 30/30 (nowrap), Mono 60/60 (normal); 375 Mono 75/75. In no case did the
ghost overflow, and in no case did the document scroll horizontally.

**Issues:**

1. **DESIGN.md rule broken: no component may branch on the type style.**
   - DESIGN.md:385-387 says: "every style is a token override in `theme.css`, never a component branch." theme.css:189
     repeats it: "Tokens only; no component branches on the style."
   - `frontend/src/features/home/ui/HomePage.css:63-65` adds `:root[data-type-style="mono"] .home-opening__ghost {
     white-space: normal; }`. That is a component rule keyed on the type style.
   - It is the first and only one in the codebase: the grep `data-type-style` over `frontend/src/**/*.css` finds only
     theme.css and this rule.
   - design.md does not name or justify the exception, and DESIGN.md was not amended.
   - The rule is greppable, so it is in the evaluator's mechanical scope. It is not a visual judgment.
   - The owner approved the behaviour ("keep nowrap off under the Mono type style"), not this way of building it, and
     the behaviour can be built inside the rule.
2. **Dead code** in `e2e/hel1665-home-phone-stability.spec.ts:468-475,504`. Every `STYLE_CASES` entry has
   `asserted: true`, so the `(measured only)` title suffix and `if (!asserted) return;` can never run.

### Phase 3: UI Review — PASS

- **Servers.** Started with `start-servers.sh`, which reported `PASS servers`. Stopped with `stop-servers.sh`.
- **Held-load behaviour.** Covered by the e2e above: 375×667/812, 430, 480, 540, 620, 1024 and 1280; light and dark;
  both orders; Mono and Serif. Every case was 0px.
- **Settled app, checked live.**
  - 375×667 light Sans: the sentence is two lines, the "All 6 →" link sits on the head line, and the cards are even.
    Screenshot: `/home/matt/Development/helio/.concertino/scratch/HEL-1665/eval4/home-375x667-light-sans.png`.
  - 1280 dark Mono: the sentence is two lines and the layout is coherent. Screenshot:
    `/home/matt/Development/helio/.concertino/scratch/HEL-1665/eval4/home-1280-dark-mono.png`.
  - The widths 620, 700, 769, 1100 and 1440 were measured in the parity probe above.
  - No horizontal scroll at any width checked.
- **Touch targets.** At 375 the "All N" and "+N more" links bisect to a 44.5px tall hit region, while their box stays
  18px and the shelf head stays 18px.
- **Accessibility.** The slot and the ghost are `aria-hidden` and `visibility: hidden`. The loading status regions
  keep their names.
- **Console.** No console errors in the tested flows. The one 403 on `/api/auth/login` came from the MCP browser's
  initial session and is unrelated to this diff.
- **Test data.** The e2e teardown deleted its 89 throwaway users. I created no data and wrote no server preference.
- The 1100 and 1440 breakpoints render; the dev account has no 24h runs, so the timeline there is the empty state.

### Overall: FAIL

### Change Requests

1. **`frontend/src/features/home/ui/HomePage.css:63-65`.** Remove the component branch
   `:root[data-type-style="mono"] .home-opening__ghost`. Keep the same behaviour (nowrap off under Mono) in a form
   DESIGN.md allows. Pick one:
   - **(a) Token override (preferred: the code meets the existing rule as written).**
     - Declare a token in `frontend/src/theme/theme.css`, for example `--heading-sentence-wrap: nowrap` on `:root`.
     - Override it inside the existing `:root[data-type-style="mono"]` block (`--heading-sentence-wrap: normal`).
       Explain why in one comment: Mono's wider glyphs wrap a 40ch heading sentence.
     - Have the ghost rule read `white-space: var(--heading-sentence-wrap)`.
     - Keep the `@media (max-width: 768px)` override as it is. It is keyed on width, not on style.
     - Update the guard in `HomePage.css.test.ts:51-53` to the token form.
   - **(b) Amend the standard.** Add the exception, with its reason, to DESIGN.md's "Type styles (HEL-1572)" bullet
     and to the theme.css:189 comment. This rewrites a binding rule to fit the code, so take (a) unless there is a
     reason not to.

   Either way, the Mono 1280 e2e case must stay green (it already shows the behaviour).
2. **`e2e/hel1665-home-phone-stability.spec.ts:468-475,504`.** Remove the dead `asserted` field: the field itself, the
   `${asserted ? "" : " (measured only)"}` title suffix and `if (!asserted) return;`. All four cases assert.

### Non-blocking Suggestions

- `DashboardShelf.tsx:45` has a nested `aria-hidden="true"` on the arrow span inside the already `aria-hidden` slot.
  It is redundant, as the round-4 skeptic noted.
- **PR CI on 9e3c98937 when I checked:** `frontend`, `backend` 0-3, `e2e (1)`, `e2e (4)` and CodeQL had passed;
  `e2e (2)` and `e2e (3)` were still pending. Confirm all green on the final head before merge. The
  DejaVu/WenQuanYi swap numbers in the spec come from the executor and the earlier CI run; I did not re-measure them
  here (CI only).
