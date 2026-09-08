# Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `fdc38037` on top of `9e2764d6` (base `origin/main` @ `6b081b86`).
Scope: the cycle-2 delta plus a regression check on what it could plausibly have broken.
Every claim below was re-measured by me; none is carried over from the executor's or the
orchestrator's summary.

---

## Delta shape — and why cycle 1's PASS findings still stand

`git diff --name-only 9e2764d6..fdc38037 -- frontend/src | grep -v test` returns **nothing**. Every
implementation file is byte-identical between the two commits, verified by object hash rather than
by reading the diff:

| File | `9e2764d6` vs `fdc38037` |
|---|---|
| `shared/chrome/useShortcut.ts` | **UNCHANGED** |
| `shared/chrome/shortcuts.ts` | **UNCHANGED** |
| `shared/chrome/HelpOverlay.tsx` | **UNCHANGED** |
| `shared/chrome/HelpOverlay.css` | **UNCHANGED** |
| `shared/ui/KeyCap.css` | **UNCHANGED** |
| `features/layout/hooks/useLayoutUndoRedo.ts` | **UNCHANGED** |

So the four verified planning-defect fixes, the focus-ring compliance, the token compliance, and the
Phase 3 UI findings from cycle 1 carry forward untouched. I spot-confirmed the four claims are still
literally true in the tree anyway (`shortcuts.ts:58` `{ key: "?" }`; `:67` `shift: false`; `:74`
`shift: true`; exactly one non-test `guardWhileOverlayOpen:` call site, `HelpOverlay.tsx:117`).
No positive evidence of regression anywhere.

The delta is confined to: one test file, one e2e file, `files-modified.md`, the deletion of 8 PNGs,
and the addition of `evaluation-1.md`.

---

## CR1 — regression guard now genuinely failable by mutation: **VERIFIED, by my own run**

This is the CR that existed because a mutation claim was asserted rather than demonstrated, so I
re-ran it rather than reading the executor's note.

```
BASELINE (unmutated)                          Tests: 2 passed, 2 total
MUTATED  layout-undo shift:false -> OMITTED   Tests: 1 failed, 1 passed, 2 total
REVERTED                                      Tests: 2 passed, 2 total
```

The failing test is the new discriminating case, and **the failure mode is exactly the one predicted**
— not merely "something went red":

```
● useLayoutUndoRedo — REGRESSION GUARD (mod+shift+z)
  › mod+shift+z changes nothing when only an undo target exists (must not fall through to undo)

  - Expected  - 2        - "panelId": "b",      (layoutB — correct: nothing happened)
  + Received  + 2        + "panelId": "a",      (layoutA — undo wrongly fired)
                         -       "x": 2,
                         +       "x": 0,
  at useLayoutUndoRedo.regression.test.ts:108
```

The layout lands on `layoutA` under mutation, i.e. the weakened `layout-undo` combo matched a
Shift-bearing event and applied an undo it must never apply. That is precisely the defect the guard
exists to catch, and precisely what the cycle-1 version failed to catch. `git status --porcelain` is
clean after both mutation runs.

**Relabelling is accurate.** The old undo-then-redo sequence is retained as a second test at
`:111-137`, prefaced by "Behavior verification (not itself the mutation-discriminating proof above)".
I confirmed by re-running the mutation that this second test does indeed stay green — so the
disclaimer is truthful, not decorative. The file header at `:12-21` now explains the cycle-1 failure
mechanism (`!undoTarget` early return absorbing the mutation) instead of asserting a catch it did not
perform.

**Nothing is still mislabelled as proof it does not carry.** The one residual imprecision is that the
`describe` block name — `"useLayoutUndoRedo — REGRESSION GUARD (mod+shift+z)"` — spans both tests,
including the behavior-verification one. The adjacent inline comment disclaims it explicitly and
unambiguously, so a reader cannot be misled. Not worth a cycle; noted below as cosmetic.

---

## CR2 — tracked PNGs removed: **VERIFIED**

- `git ls-files 'openspec/**/*.png'` → **0**.
- The `screenshots/` directory no longer exists in the worktree.
- All 8 files present at
  `.concertino/runs/HEL-510/evidence/openspec/changes/keyboard-shortcut-help-overlay/screenshots/`
  (counted: 8).
- Not force-re-added anywhere; working tree clean.
- `files-modified.md` gains a "Visual-cohesion evidence (task 5.2)" section that points at the
  durable path, lists all 8 filenames, and — the part that matters most — **restates the cohesion
  conclusion in prose**, so the artifact remains self-contained for a reader who cannot reach the
  evidence store. That is a better outcome than the original commit, not merely a removal.

**One finding worth surfacing beyond this ticket.** Re-running the history query with `--all` this
cycle surfaced a second commit I did not see in cycle 1: `fe76979f` ("HEL-448 Add in-panel column
sort to table panels") adds four PNGs under `openspec/changes/**/screenshots/`. It lives only on the
unmerged sibling branch `feature/in-panel-column-sort/HEL-448`, and `origin/main` still carries
**zero** `openspec/**` PNGs — so cycle 1's ruling is unaffected and CR2 was correct. But a concurrent
lane is queued to land the identical gitignore violation. That is an orchestrator/owner matter, not a
HEL-510 change request; flagging it because it will otherwise merge unnoticed.

---

## CR3 — deferral write-up: **honest and substantially complete; one cheap improvement**

The new "Known limitation / evidence (task 5.3, evaluation-1.md CR3)" section is candid in exactly
the way the evidence rule is meant to produce. It states plainly that the executor's own 5.3 check
"was a shallow smoke test (pressed Ctrl+Z/Ctrl+Shift+Z with no panel ever dragged, confirming only
'no crash')" and that the limitation "was never written down in any committed artifact". Self-reported
weakness, without hedging. It then cites my Phase 3 probe as what actually closes 5.3, and reproduces
the specific discriminating observations (`defaultPrevented === true`, history consumed, redo
enabled) rather than just linking out — so the artifact stands alone. It also records the
visual-revert defect as out-of-scope and pre-existing, with the reasoning (untouched
`app/CommandBar.tsx` reproduces it).

**On the orchestrator's direct question — yes, it should cite the ticket ids.** The binding rule is
"a deferral is only real if it names a task that exists **and a ticket that owns it**". The write-up
currently says the visual-revert defect was "filed as its own ticket" without naming it, so a future
reader of `files-modified.md` cannot dereference the owner. Now that **HEL-1028** and **HEL-1029**
exist, adding those two ids is a two-string edit that takes the deferral from "believable" to
"verifiable".

I am **not** making that a blocking change request. The substance CR3 asked for — an honest,
committed account of what was and was not measured — is fully delivered, and holding a cycle over two
missing ticket ids in a handoff document would be disproportionate. Fold it in before merge
(suggestion 1).

---

## Cheap fix — e2e case (d): **VERIFIED**

`e2e/hel510-keyboard-shortcuts.spec.ts:89-98` now runs a second loop pressing `Shift+Tab`
`focusableInDialog + 2` times, asserting containment after each press. The test's title no longer
overstates what it exercises.

---

## Gates — all re-run by me from `frontend/`, not read from the report

Run from `frontend/`, never the worktree root: root `npm test` is
`jest --passWithNoTests && npm --prefix frontend test`, which in a worktree root finds zero tests and
turns silence into a pass.

| Command | cwd | Result |
|---|---|---|
| `npm run lint` (`eslint src --max-warnings=0`) | `frontend/` | PASS, no output |
| `npm run typecheck` (`tsc --noEmit`) | `frontend/` | PASS, no output |
| `npm run format:check` (`prettier . --check`) | `frontend/` | PASS — "All matched files use Prettier code style" |
| `npx jest --silent` | `frontend/` | **276 suites / 2801 tests, all passed** (+1 vs cycle 1, the new discriminating case — the count moves for the stated reason) |
| `npm run check:e2e-types` (`tsc --noEmit -p e2e/tsconfig.json`) | worktree root | PASS, no output |
| `npx playwright test e2e/hel510-keyboard-shortcuts.spec.ts` (`DEV_PORT=5942`) | worktree root | **6 passed**, real Chromium against the live dev/backend servers |

No `backend/**` file changed, so `sbt test` remains out of scope. `check:no-credential-leak` (scans
only `frontend/src/features/assistant/**`) and `check-schema-drift.mjs` (reads only `schemas/**`)
scan zero changed files and are therefore vacuous here — not cited as evidence.

The 6/6 Playwright run against the live servers doubles as the Phase 3 re-check: the overlay still
opens on `?`, Esc still closes and restores focus, focus containment holds in **both** tab
directions, both suppression guards still hold, and Cmd/Ctrl+K still works while the palette is open.

---

## Phase 1: Spec Review — PASS
## Phase 2: Code Review — PASS
## Phase 3: UI Review — PASS (re-verified via the live-server e2e run; no UI source changed)

## Overall: PASS

All three cycle-1 change requests are resolved, and the one that mattered — CR1 — is resolved with a
mutation I ran myself, producing the exact predicted failure mode rather than a generic red. No
implementation file changed, so nothing that passed in cycle 1 could have regressed, and I confirmed
that by hash rather than assuming it.

## Non-blocking Suggestions

1. **Add the two ticket ids to `files-modified.md`.** In the "Known limitation / evidence" section,
   replace "filed as its own ticket" with **HEL-1028**, and cite **HEL-1029** for the
   `shared/ui/Modal` heading-focus-ring finding. This is what makes the deferral fully dereferenceable
   under the "names a ticket that owns it" rule. Cheap enough to fold in before merge without another
   review cycle.
2. **Cosmetic:** the `describe` block at `useLayoutUndoRedo.regression.test.ts:84` is named
   "REGRESSION GUARD (mod+shift+z)" but now contains one guard and one behavior-verification test.
   The inline disclaimer at `:111` makes this unambiguous, so it misleads no one; splitting into two
   `describe` blocks would be tidier if the file is touched again for another reason.
3. **Out of band, for the orchestrator/owner, not this ticket:** sibling branch
   `feature/in-panel-column-sort/HEL-448` (commit `fe76979f`) carries four PNGs under
   `openspec/changes/**/screenshots/`, i.e. the same gitignore-allowlist violation CR2 removed here.
   `origin/main` is still clean; it will not stay clean if that branch merges as-is.

Two items were explicitly routed away from me and are deliberately absent above: the dark-theme
keycap-surface observation (design judgment → final-gate skeptic) and the KeyCap-in-palette cohesion
gap (escalated to the owner). Neither influenced this verdict.
