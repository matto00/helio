## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Owner-override round, scoped to whether the round-2 correction is **truthful and
complete**, plus cheap re-confirmation of the code. Every claim below is from a
command I ran myself in this worktree.

### 0. The last two commits really are documentation-only

`git diff --stat a461747e HEAD` → `files-modified.md`, `proposal.md`,
`skeptic-final-2.md` only. No source file changed since round 2's CONFIRM of the
code. `git diff main...HEAD -- frontend/.../DashboardList.css` is byte-identical
to what round 2 reviewed.

### 1. Claim 1 — `hel910` is genuinely exercised: VERIFIED

- `npx playwright test --list | grep -c hel910` → **2**; both tests appear in the
  listing (`hel910-...:90` and `:208`) and both ran and passed in my own suite run.
- Not on the quarantine register (`grep hel910 playwright.config.ts` → no match).
- The `exact: true` edit at `:187` is inside a test that executes.

### 2. Claim 2 — `hel909` is NOT exercised: VERIFIED, including the stated reason

- `npx playwright test --list | grep -c hel909` → **0** (my own run).
- `playwright.config.ts:48-52` carries the entry
  `"**/hel909-output-picker-panel-sheet.spec.ts"` under the comment:
  *"Quarantine (HEL-951) — hel909-output-picker-panel-sheet.spec.ts: a panel
  placed via the OutputPicker never becomes visible in the grid / mobile stack;
  all four tests in the file fail the same way. Follow-up: HEL-963."*
  The corrected artifacts quote this reason **verbatim and correctly** — this is
  not a plausible-but-invented causal story; I compared it against the config
  text line by line, including the HEL-951 register / HEL-963 follow-up split.
- The corrected text correctly labels the three edits as reasoning-only, states
  they are excluded from the 42 count, and carries the explicit re-verify warning
  for whoever unquarantines HEL-951/HEL-963.

### 3. Claim 3 — 42 passed: VERIFIED INDEPENDENTLY

`DEV_PORT=6435 BACKEND_PORT=9342 npx playwright test --workers=1` →
**`42 passed (2.4m)`**, my own run. `--list` also reports `Total: 42 tests in 8
files`, so the count is fully accounted for: 42 listed = 42 run = 42 passed, with
`hel909` contributing 0. The four `hel1003-actions-menu-keyboard-reach.spec.ts`
tests are in that listing and passed — the guard is not dead code.

Rig freshness verified **functionally**, not by health probe (CON-155): I fetched
`http://localhost:6435/src/features/dashboards/ui/DashboardList.css` and confirmed
the served module contains the fix (`clip: rect(0, 0, 0, 0)`, `position: absolute`
resting; `clip: auto` reveal), i.e. the dev server is serving *this* worktree.

### 4. Does the correction SHOW the correction? YES

Both `files-modified.md` (~line 57) and `proposal.md` (~line 155) state in terms
which claims were false — *"An earlier revision of this document said these sites
were 'now exercised' and had previously 'passed' — both statements are false, and
were not verified before being written"* — rather than silently reading as though
the error never happened. This satisfies the owner's explicit instruction.

### 5. Is the correction COMPLETE? YES — swept

`grep -rn -i hel909` across the whole change dir returns hits in only three files:
`proposal.md` and `files-modified.md` (both carrying the corrected text) and
`skeptic-final-2.md` (the report that raised it). `evaluation-1.md`,
`evaluation-2.md`, `tasks.md`, `design.md`, `ticket.md`, `workflow-state.md`, and
the spec delta contain **no** `hel909` mention and no `"42 passed"` / `exercised`
claim at all — so there is no residual false framing anywhere. Partial-correction
risk: cleared.

**Durability: YES.** The full corrected text lives in `proposal.md:138-160`, not
only in `files-modified.md` (which is deleted at delivery). The correction
survives into the PR and archive.

### 6. Refuted claims are not live assertions; mechanism not reintroduced

- The 430 keyboard defect and the "originally-proposed fix" are both recorded
  **as REFUTED** (`ticket.md` "REFUTED"/"WITHDRAWN" sections; `design.md` R3/R6;
  `proposal.md:19`), with `App.css:604-609` and `affbec86e` cited correctly.
- Paint-clipping sweep: every surviving mention across `design.md:220`,
  `skeptic-design-5/6`, `skeptic-final-1` states it is **not** the mechanism. No
  artifact reintroduces it. Flex-shrink remains the recorded cause.

### 7. Code re-confirmed cheaply — both arms, run by me

- **Red arm.** Reverted the CSS to `574b7774~1` and re-ran `hel1003`:
  `1 failed, 3 passed` — the discriminating test
  *"resting trigger is a real focus target"* failed at `spec:87` on the
  `document.activeElement === document.body` sentinel. CSS restored via
  `git checkout --`; `git status --porcelain` empty afterwards.
- **Green-but-broken arm (the AC-3a risk case).** Mutated the reveal rule to
  reset only `display`/`align-items` (dropping `position`/`clip`/sizing) and
  re-ran: `1 failed` — `expect(revealed.position).toBe("relative")` got
  `"absolute"`. So the geometry guard genuinely catches the focusable-but-never-
  painted state the AC warns about. CSS restored; tree clean.
- Full-suite green arm as shipped: 42 passed (above).
- `npm run typecheck` clean; `npm test` → **261 suites / 2676 tests passed**;
  `npm run format:check` clean.

### 8. AC trace

1. Programmatic `.focus()` at desktop → `hel1003` test 2, green as shipped, red on
   revert (both arms observed by me).
2. Keyboard unregressed → test 4, real `Tab`/`Enter`/`Escape` (not `.focus()`).
3. Resting row button 215px → test 3 asserts 210–220, passed.
3a. Reveal painted → test 3 asserts `position: relative`, `clip: auto`,
   `height > 1`, trigger 24x24, row button 183–191 (the 187px reflow); passed, and
   proven load-bearing by the mutation in §7.
4. Playwright guard, discriminating on programmatic focus with the body sentinel,
   proven in both arms → §7.
5. Negative controls present (`hel1003` test 1 is an explicit not-found control)
   and I negative-controlled the two probes I relied on myself.
6. jsdom triage annotations present in `ActionsMenu.test.tsx` (+11) and
   `MobileNavSheet.test.tsx` (+8); `MobileNavSheet.tsx` itself untouched (D2).

Scope respected: no migration, `MobileNavSheet.tsx` unchanged, HEL-1005/HEL-1006
left out.

### Verdict: CONFIRM

The correction is accurate against `playwright.config.ts`, complete across every
artifact, durably recorded in `proposal.md`, and written so the error it fixes is
visible rather than erased. The code re-confirms green with a reproduced red arm
and a reproduced mutation kill.

### Non-blocking notes
- A stray, **gitignored** screenshot `hel1003-hover-list.png` (18:43 today) sits at
  the *main* checkout root, outside this worktree — a leftover from an earlier
  round, not from mine. It cannot reach the PR (`.gitignore:42 *.png`), so it is
  not a blocker; worth deleting during Phase-4 cleanup. My own worktree is clean
  (`git status --porcelain` empty) and I removed the `test-results/` dirs my two
  mutation runs produced.
- The revealed wrapper's `position: relative` is inherited from
  `Popover.css:1-3`, so under the *fully reverted* CSS that assertion still
  passes — consistent with AC 3a's own wording ("*not* `static`, which a correct
  implementation never produces") and with the design gate's rejection of the
  fabricated `position: static` measurement. It discriminates the partial-fix
  state (§7), which is the state it exists for. No artifact overclaims it as the
  red-arm proof; the labelling is correct.
