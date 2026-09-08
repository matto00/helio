## 1. Baseline and provenance (BEFORE any edit)

- [x] 1.1 Start the dev server (DEV 5874 / BACKEND 8781). **Prove provenance before recording anything visual**: confirm the listener's `/proc/<pid>/cwd` is THIS worktree (`ss -lptn`), AND `curl` the dev server for a string unique to this branch, verifying it is absent on `main`. Vite auto-increments when a port is taken, so a port number alone is NOT provenance
- [x] 1.2 Record baseline gates: `npm run lint`, `npm run typecheck`, `npx jest` from `frontend/` — paste counts. NOT root `npm test` (its `--passWithNoTests` leg finds nothing at a worktree root)
- [x] 1.3 Confirm the guard's RED arm is reachable BEFORE the guard exists: add a throwaway literal `box-shadow` and an off-scale `border-radius` to a real component, confirm NOTHING currently catches either, then revert. This establishes the good state is genuinely unprotected

### Frontend

## 2. The guard (the durable deliverable — design D4)

- [x] 2.1 Add `frontend/src/theme/elevationTokenGuard.css.test.ts` alongside `motionTokenGuard.css.test.ts`: a `box-shadow` must use `--app-shadow-card`/`--app-shadow-soft` or sit on a pinned exception; a `border-radius` must use one of the four tokens, `50%`, or `0`/`none`/`inherit`, or sit on a pinned exception. Parse multi-line declarations — a line grep truncates these and reports garbage
- [x] 2.1a **The shadow check must test against the two ELEVATION TOKENS BY NAME, never "contains `var(`".** My own audit was wrong precisely because `grep -v "var(--"` scored 22 declarations clean whose colour is tokenised and geometry literal. A "contains any var()" rule would make task 2.4's required RED mutation PASS GREEN — that loosening is forbidden
- [x] 2.1b **Generate every pinned exception's text and count by re-measuring the tree at implementation time, NOT by transcribing the numbers from these artifacts** — a transcribed pin can be wrong the moment a sibling lane touches a file, and this ticket has already had approximate counts pass as exact twice. Pin the two non-elevation shadow families **to EXACT file + declaration text + count — never a per-file or pattern allowance, which can never expire**: (i) **9** zero-blur spread rings (`0 0 0 3px var(--app-accent-dim)` x6, AccentPicker's double ring x2, `0 0 0 3px var(--app-error-surface)` x1) — `--app-focus-ring` is an OUTLINE token, a different mechanism; converging them is HEL-1022's remit; (ii) **13** scroll-fade insets in **FOUR distinct values** (12px x4, -12px x4, combined x4, ConnectorsPage's `inset 8px 0 8px -8px` x1) — NOT byte-identical. Annotate each with why no elevation token applies: none carries a y-offset with a blur. REPORT the scroll-fade duplication as a spinoff candidate — do NOT absorb it
- [x] 2.2 D1 — treat `50%` as an ALLOWED value, NOT a pinned exception. It is the circle idiom on 12 live declarations; an exception entry would invite a future ticket to "resolve" it and break avatars, the spinner and the toggle knob
- [x] 2.3 Pin any genuine exception (whichever sub-scale radii survive task 3.1) to an exact file, declaration and count, annotated with the ticket that would remove it
- [x] 2.4 Mutation-prove in FOUR directions, each targeting a DISTINCT failure mode so no two arms are the same test: (1) a new literal `box-shadow` in a file carrying NO exception -> RED; (2) a new off-scale `border-radius` -> RED; (3) a STALE exception matching nothing in the tree -> RED, run TWICE — once against a SHADOW exception and once against a RADIUS exception — so BOTH families are demonstrated expirable (round 3's tightening moved this arm to shadows and silently dropped radius coverage; both are required); (4) a literal shadow inserted INTO an exception-bearing file (e.g. `DataGrid.css`) -> RED, which is the only arm that can catch a per-file or pattern-shaped allowance. The fourth arm is required: the first three cannot catch a per-file or pattern-shaped allowance, under which a new literal in an excepted file passes silently. Paste all four transcripts. Label it a guard
- [x] 2.5 Verify what the guard actually scans: confirm the CSS file count it walks, and state what it does with a file carrying zero shadow/radius declarations, so the count is not a vacuous pass

## 3. The judgment calls (design D2/D3 — decided on the running app, NOT snapped)

- [x] 3.1 Decide each of the five sub-scale radii individually in both themes — `1px` (DividerPanel, PipelineDetailPage), `3px` (MarkdownPanel), `4px` (MarkdownPanel, PipelineDetailPage). **Default is LEAVE.** Snapping to 6px is a visible 2-5px change on decorative detail. Change one only where the token genuinely looks right; where it does not, keep the literal and add a comment saying why. Record before/after for each
- [x] 3.2 D3 REVISED — `BottomNav.css:38-39` is **VERIFICATION ONLY, not a decision to re-make**. `DESIGN.md:123-135` is an explicit HEL-774 carve-out naming BottomNav as the app's one permitted translucent surface, with a MEASURED contrast floor rather than an eyeballed judgment; `BottomNav.css:35-37` cites it. Confirm the implementation still matches the carve-out (blur within 10-16px, tint layer present, icon-only) and move on. Do NOT reopen it on a visual impression
- [x] 3.3 **Do NOT touch `Modal.css:60`.** Its `backdrop-filter` sits on `.ui-modal::backdrop`, which **HEL-1035** owns. Confirm by `git diff` that the file is unmodified
- [x] 3.4 **Do NOT modify any of the 46 accent-border sites.** `DESIGN.md:93` documents `--app-accent-mid` as the selection-border token; they are correct. Confirm by `git diff` that no accent border changed

## 4. What no source text carries (design D5) — the finding a guard cannot make

- [x] 4.1 Vendor half is DONE and NEGATIVE (`react-grid-layout`, `react-resizable` impose no radius/shadow/border) — verify that independently rather than inheriting it, then move on
- [x] 4.2 On the running app in BOTH themes, hunt for **surfaces with NO elevation where the ramp says there should be one**. An absence has no grep signature — this is how HEL-1035 was found — so it must be a FIXED INVENTORY with a per-item recorded result, not an open-ended look. Inspect each and record confirmed / mismatched / unreachable:
  - every overlay: Modal panel, Popover, Toast, MobileNavSheet, RefinementChatDrawer, ShapePickerModal, RunHistoryModal — each should sit on `--app-surface-strong` and carry `--app-shadow-soft`
  - every card surface: panel grid card, DashboardList row, PipelineListTable row, ConnectorsPage card, SourceListTable row — `--app-surface` + `--app-shadow-card` at rest
  - every recessed well: `.ui-input`, `.ui-textarea`, DataGrid header, code/pre blocks — `--app-surface-soft`
  - the canvas itself and the empty state — `--app-bg`, no shadow
  A surface that is flat where the row says it should be raised is the finding; report it and file a spinoff rather than absorbing
- [x] 4.3 D6 — verify the ramp by COMPUTED STYLE (`getComputedStyle().backgroundColor`) in BOTH themes against design.md's FIXED table, one row at a time; report each as confirmed or mismatched. A rung you cannot reach is REPORTED as a gap, never skipped:
  - canvas -> dashboard grid background -> `--app-bg`
  - recessed well/input -> a `.ui-input` at rest, `DataGrid` header -> `--app-surface-soft`
  - card/chrome -> a panel card, sidebar, top bar -> `--app-surface`
  - hover -> that same card under `:hover` -> `--app-surface-raised`
  - overlay -> Modal panel, Popover, Toast -> `--app-surface-strong`

## 5. Docs and gates

- [x] 5.1 DESIGN.md: record that `50%` is a valid radius for circles (D1), whatever task 3.1 decided about sub-scale radii, and the `BottomNav` backdrop-filter outcome. Also record that accent-tinted borders on selection/state are CORRECT per line 93 — so a later reviewer does not "fix" the 46 sites
- [x] 5.2 `npm run lint`, `npm run typecheck`, `npx jest` from `frontend/` green with ZERO new warnings; paste counts against 1.2's baseline
- [x] 5.3 Screenshots to `.concertino/runs/HEL-442/evidence/`; never `git add -f` past `.gitignore`. Verify captured images are DISTINCT (`md5sum`) — a previous lane shipped 12 "before/after" PNGs that were 2 images

## 6. Delivery

- [x] 6.1 Rebase onto latest `main`; re-run 5.2 and re-check visuals if frontend files moved
- [x] 6.2 PR body states the CORRECTED measured audit — of 47 `box-shadow` declarations, 22 use neither elevation token, split 9 zero-blur spread rings + 13 scroll-fade insets (four distinct values), none carrying a y-offset with a blur, so no elevation token applies to any; 12/17 radii are correct-by-idiom (`50%`) — that accent borders are NOT drift, which sub-scale radii were left and why, and that the guard is the deliverable. **Do NOT publish the retracted "0/47 literal" figure**
