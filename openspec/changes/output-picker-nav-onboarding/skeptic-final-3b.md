## Skeptic Report — final gate, Axis B: Frontend UX / DESIGN.md / Accessibility (round 3, skeptic-final-3b.md)

Human-approved narrow extension beyond the normal 2-round budget, scoped to **one mechanical
fix**: commit `f71bf778` "Decouple hover from keyboard focus in OutputPicker", answering the two
change requests in `skeptic-final-2b.md`. The backend/data-integrity and migration/spec-accuracy
axes CONFIRMed cleanly in rounds 1–2 and were **not** re-run, per the orchestrator's instruction.

*Filename note:* `next-report-number.sh` returned `number=1` / `skeptic-final-1.md` — it does not
model the `-Na/-Nb/-Nc` per-axis suffix convention this fan-out uses, so it sees no
`skeptic-final-<n>.md`. Written as the orchestrator-specified `skeptic-final-3b.md`, verified
collision-free by `ls` (no `skeptic-final-3*` existed), persisted with `--no-clobber`.

### Environment / freshness

- HEAD = `f71bf778` (`2026-09-02T01:01:57-07:00`); worktree clean (`git status --porcelain` empty).
- `start-servers.sh $PWD 6341 9248 HEL-909` → both already healthy, **reused** (started before the
  commit), so I proved rather than assumed the served bundle is current:
  `curl -s http://localhost:6341/src/features/panels/ui/OutputPicker.tsx | grep -c hoveredIndex`
  → `3`, and the served `OutputPicker.css` contains `card--hovered` → `1`. Vite transforms
  per-request from disk; the served modules are this commit's.
- `assert-phase.sh servers` → `PASS servers`.
- Every UI assertion below is read from the **live DOM / `getComputedStyle`**, not from source.
- Shared Playwright session with sibling agents (observed drift once; re-navigated to a clean
  state before measuring). The headline keyboard-nav repro was **run twice**, at two viewport
  widths, with matching results.

### What I verified (with evidence)

| # | Check | Evidence | Result |
|---|---|---|---|
| 1 | **Round-2 F1: keyboard nav is no longer hijacked by a stationary cursor** — mobile-width run | Real cursor parked on `#output-picker-option-2` via Playwright `mouse.move`; search focused; **12 real `ArrowDown` key presses**. `MutationObserver` on `aria-activedescendant` recorded `1,2,3,4,5,6,7,8,9,10,11,12` — strictly monotonic, 12 presses = 12 advances. Critically, a listener on every card recorded **9 genuine `mouseenter` events** (options 3–11) firing from scroll re-hit-testing under the stationary cursor — *the exact causal mechanism of the round-2 bug occurred, and focus did not move.* | **PASS** |
| 2 | Same, **reproduced** at desktop width (1440×900, true multi-column grid — options 11/12/13 share a row) | Cursor parked on `#output-picker-option-9`; 12 real `ArrowDown` presses → `13,14,15,16,17,18,19,20,21,22,23,24`, strictly monotonic, despite **6 real `mouseenter`s** (options 10, 11, 14). Final `aria-activedescendant` = `output-picker-option-24`; `--card--focused` count = 1. Round 2's signature (`31,32,33,34,32,33,34,35,…` — advance 5 per 12 presses, 3-step jump-backs) is **absent in both runs** | **PASS** |
| 3 | **Round-2 F2: hover ≠ keyboard focus, dark** | With option-14 hovered and option-24 keyboard-focused *simultaneously*: hovered → `class="output-picker__card output-picker__card--hovered"`, `aria-selected="false"`, `outline-style: none`, `border-color rgba(242,239,233,0.18)`, `bg rgb(35,32,25)`. Focused → `--card--focused`, `aria-selected="true"`, `outline: solid 2px rgb(249,115,22)` @ `outline-offset 2px`. Screenshot `hel909-r3-hover-vs-focus-dark.png` shows exactly one orange ring | **PASS** |
| 4 | Same, **light parity** | `--app-accent #f97316`, `--app-border-strong rgba(33,29,25,0.2)`, `--app-surface-raised #ffffff`. Hovered → `outline-style: none`, `border-color rgba(33,29,25,0.2)`, `bg rgb(255,255,255)` (the sanctioned neutral recipe round 2 PASSed as its check #8). Focused → `solid 2px rgb(249,115,22)` @ offset 2px. All values token-derived, nothing hardcoded through. Screenshot `hel909-r3-hover-vs-focus-light.png` | **PASS** |
| 5 | **Hover alone never moves or duplicates the ring** | Keyboard focus resting on option-0; hovered `#output-picker-option-3` with the mouse and touched no key → `aria-activedescendant` **stayed** `output-picker-option-0`; option-3 = `--hovered` only, `aria-selected="false"`, `outline-style: none`; `--card--focused` count 1, `--card--hovered` count 1, on **different** elements | **PASS** |
| 6 | Exactly one option selected inside the picker | `[role=option][aria-selected=true]` returned 2 nodes, but the second is `#command-palette-option-nav.dashboards./` — an unrelated, pre-existing command-palette element outside the picker. Within `#output-picker-listbox`: exactly 1 | **PASS** (not a defect) |
| 7 | **Regression test red-first claim — reproduced myself, not trusted** | `npx jest --testPathPatterns=OutputPicker.test -t "hijacked"` at HEAD → **1 passed**. Then `git checkout 52222878 -- OutputPicker.tsx OutputPicker.css` (reverting *only* the fix, keeping the new test) → **FAILS** at `OutputPicker.test.tsx:346` with `Expected aria-activedescendant="output-picker-option-1" / Received "output-picker-option-0"` — i.e. focus snapped back to Alpha, the *hovered* card: the bug's exact signature. Restored with `git checkout f71bf778 -- <both files>`; worktree clean; 12/12 pass | **PASS** |
| 8 | The test genuinely exercises the failure path | Read in full: it interleaves `fireEvent.keyDown(inner, ArrowDown)` with `fireEvent.mouseEnter(alpha)` on a *different* card inside one `act()`, then asserts focus continues to Charlie/Delta, and additionally asserts `alpha` has `--hovered` and **not** `--focused`. Not a vacuous green — proven red above | **PASS** |
| 9 | **Fix stayed in its stated narrow scope** | `git diff --name-only 52222878..f71bf778` (excluding openspec artifacts) = exactly 3 files: `OutputPicker.{tsx,css,test.tsx}`. Grepping the diff hunks for `role=`, `aria-activedescendant`, `aria-controls`, `scrollIntoView`, `listbox`, `OPTION_ID_PREFIX` matches **only comment prose** (2 lines) — zero functional change to the listbox markup, the activedescendant wiring, or the `scrollIntoView` call. The CSS delta is a single added selector (`.output-picker__card--hovered` joined to the existing `:hover` rule); the `--card--focused` accent rule is byte-unchanged | **PASS** |
| 10 | Round-1/2 confirmations not regressed (light-touch) | Live: search = `class="ui-input output-picker__search"`, `type="search"`, computed `height: 32px` (`--control-md`), `aria-controls="output-picker-listbox"`; `.output-picker__inner` padding `4px`; `.eyebrow` group headings present (51); 84 options render; **0 console errors** | **PASS** |
| 11 | Gates re-run fresh by me | `npx tsc --noEmit -p frontend/tsconfig.json` exit 0; `npx eslint src --max-warnings=0` exit 0; `npx jest` → **252 suites / 2591 tests passed** (2590 in round 2, +1 = the new regression test) | **PASS** |

---

### Verdict: CONFIRM

Both round-2 change requests are genuinely fixed, and the fix is the right shape rather than a
symptom patch: `hoveredIndex` and `focusedIndex` are now independent, with `focusedIndex` alone
driving `aria-activedescendant` / `aria-selected` / the accent ring, and `hoveredIndex` driving
only a neutral tint.

The evidence I weigh most heavily is check #1/#2: I did not merely observe that arrow navigation
works — I confirmed that **the causal event still fires**. Nine (then six) real `mouseenter`
events were dispatched by the browser onto cards sliding under a genuinely stationary cursor
during the key sequence, and the focus index still advanced strictly monotonically. That rules out
the possibility that the repro simply failed to reproduce the conditions, which is the way this
class of "fixed" claim usually turns out to be false. The red-first claim also held up when I
reverted the fix myself and watched the new test fail with the bug's exact signature.

Scope discipline is clean: three files, and the listbox markup, activedescendant wiring,
`scrollIntoView`, and every CSS recipe verified in rounds 1–2 are untouched. Nothing on the
frontend axis regressed; the full suite is green with exactly one net new test.

This ships.

### Non-blocking notes

- **N1 (carried forward from round 2, unchanged and out of scope here)** — the Content row is a
  second `role="listbox"` (`aria-label="Content panels"`, no `id`) sharing the `OPTION_ID_PREFIX`
  index space, while the search input's `aria-controls` names only `output-picker-listbox`.
  Arrowing past the last Output moves the active descendant into a listbox the input does not
  declare. Strict-ARIA polish; works and tests green. Worth a spinoff, not a blocker.
- **N2 (carried forward)** — the search input is not sticky; it scrolls out of view in the long
  list. Pre-existing, judgment-only.
- **N3 (carried forward, round-1 finding #9)** — pipeline-grouping leaves much of the multi-column
  grid empty across a long scroll. Still my judgment that this reads as loose at desktop width,
  but it was never in the blocking set and I am not raising it in a final round.
- **N4** — the light-theme hover background delta is subtle (`rgb(253,252,250)` → `#ffffff`); the
  `--app-border-subtle` → `--app-border-strong` change carries most of the affordance. This is the
  sanctioned DESIGN.md neutral hover recipe and round 2 explicitly passed it, so it is recorded
  as an observation only.
- **N5 — screenshots** written to `/home/matt/Development/helio/hel909-r3-hover-vs-focus-dark.png`
  and `hel909-r3-hover-vs-focus-light.png` (Playwright's output dir is the main checkout, not this
  worktree).
