# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `9e2764d6` (base `origin/main` @ `6b081b86`).
All gates below were **re-run by the evaluator**, not taken from the executor's report.

---

## Verification of the four named planning defects

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Tri-state `shift` correct | **CONFIRMED (with one caveat, CR1)** | `shortcuts.ts:57` `combo: { key: "?" }` — `shift` genuinely absent (`hasOwnProperty` guard at `shortcuts.test.ts:29-31`). `shortcuts.ts:67` `layout-undo` = `{ key: "z", mod: true, shift: false }`. `shortcuts.ts:74` `layout-redo` = `shift: true`. `matchesCombo` enforces both directions exactly (`shortcuts.ts:83-84`). |
| 2 | `isOverlayOpen()` queries both selectors | **CONFIRMED** | `shortcuts.ts:110` — `document.querySelector('dialog[open], [aria-modal="true"]')`. Premise re-verified in the tree: `RefinementChatDrawer.tsx:231` and `MobileNavSheet.tsx:339` are the only two `aria-modal` sites and are both portalled non-`<dialog>` surfaces. |
| 3 | Only `help-overlay` is guarded | **CONFIRMED** | Exactly one `guardWhileOverlayOpen` call site in the diff: `HelpOverlay.tsx:112`. `GlobalCommandShortcuts.tsx` sets it on neither binding; `useLayoutUndoRedo.ts` sets it on neither. Proven live: Cmd/Ctrl+K still opens/keeps the palette open (e2e case (g), and my own live-browser run). |
| 4 | `useShortcut` signature frozen, not widened | **CONFIRMED — no widening** | `ShortcutOptions` (`useShortcut.ts:17-24`) is exactly `{ when?: boolean; allowWhileTyping?: boolean \| ((target) => boolean); guardWhileOverlayOpen?: boolean }`. No fourth member, no extra positional argument. |

### Focus ring (HEL-1022 / DESIGN.md §8)

Grepped every new CSS file. Exactly one ring rule exists — `HelpOverlay.css:46-49`:
`:focus-visible` (never bare `:focus`) with `outline: var(--app-focus-ring)` (never a hand-rolled
value). `KeyCap.css` declares no focus rule (a `<kbd>` is not focusable). **No violation.**

---

## Phase 1: Spec Review — FAIL

Ticket AC coverage:

- `?` opens the overlay, grouped by area; palette action opens it; `Esc` closes — **verified live**
  (my own browser session: `?` opened it, the palette action `help.shortcuts` opened it and closed
  the palette first, `Esc` closed it).
- Palette-open / quick-launcher / undo / redo all listed and platform-correct — **verified live**
  (rendered caps: `Ctrl K`, `Ctrl J`, `?`, `Ctrl Z`, `Ctrl Shift Z`). No shipped HEL-347 binding
  exists, correctly unlisted.
- `?` suppressed while typing and while a modal is open — **verified in a real browser under
  mutation** (see Phase 2 evidence).
- Shared `Modal` + mono keycaps + tokens, light/dark — **verified live** (computed values, both
  themes).
- Registry unit test + help-overlay render test, lint/test green, zero new warnings — **verified**.

Issues:

1. **[BLOCKING — CR3] `tasks.md` 5.3 is marked `[x]` but was not performed as written.** 5.3 requires
   "a transcript showing a layout change reverted and reapplied". No layout change was ever made
   (no panel was dragged). The executor's own limitation note appears in **no committed artifact** —
   `files-modified.md` does not mention it, and `grep -rn -i 'drag|limitation|caveat|not exercised'`
   over the change dir returns only unrelated `design.md` hits. Under this ticket's binding evidence
   discipline ("a deferral is only real if it names a task that exists and a ticket that owns it"),
   this deferral names neither in the record and the task reads as fully satisfied.
   *Mitigating: I performed the missing measurement myself — see Phase 3 — and it comes back clean
   for HEL-510. The remaining fix is honest bookkeeping, not re-work.*
2. **[BLOCKING — CR2] Eight binary PNGs committed past a deliberate `*.png` gitignore.** See Phase 2.

No AC silently reinterpreted. No scope creep: the diff stays inside `shared/chrome`, `shared/ui`,
`features/commandPalette`, `useLayoutUndoRedo.ts`, `App.tsx`, and `e2e/` — none of the collision-lane
files (table panels, tokens, theming, `PanelGrid`) are touched. No wire/schema surface exists, and
`openspec validate keyboard-shortcut-help-overlay --type change` exits zero ("is valid").

Downstream impact (evidence rule 5) is real and was checked, not waved past: the frozen
`ShortcutOptions` contract, the `useShortcut(id, handler, opts)` call shape, the `shared/ui/KeyCap`
primitive, and the `{ key, mod?, shift? }` tri-state combo are what HEL-516/519/503 inherit. All four
are documented at the point of use and none was widened.

---

## Phase 2: Code Review — FAIL

### Gates re-run by me (not the executor's report)

Run **from `frontend/`**, not the worktree root — the root `npm test` is
`jest --passWithNoTests && npm --prefix frontend test`, which in a worktree root finds zero tests and
turns silence into a pass. What I actually ran and what each covered:

| Command (cwd `frontend/`) | Result | What it actually scanned |
|---|---|---|
| `npm run lint` (`eslint src --max-warnings=0`) | PASS, clean | all of `frontend/src`, zero-warning policy |
| `npm run format:check` (`prettier . --check`) | PASS | "All matched files use Prettier code style" |
| `npm run typecheck` (`tsc --noEmit`) | PASS, no output | whole frontend project |
| `npx jest --silent` | **276 suites / 2800 tests, all passed** | the real frontend suite, incl. every file below |
| `npx playwright test e2e/hel510-keyboard-shortcuts.spec.ts` (`DEV_PORT=5942`) | **6 passed** | real Chromium, real key dispatch |
| `npx openspec validate ... --type change` | PASS | change artifacts |

No `backend/**` file changed, so `sbt test` is not in scope.
`check:no-credential-leak` (scans only `frontend/src/features/assistant/**`) and
`check-schema-drift.mjs` (reads only `schemas/**`) are **vacuous for this diff** — neither scans a
single changed file — and are therefore not cited as evidence here.

### Unmodified-test discipline — verified from the diff, not taken on trust

- `useLayoutUndoRedo.test.ts` — **not in `git diff --name-only 6b081b86...HEAD`. Unmodified.** Passes.
- `hooks.test.tsx` — **not in the diff. Unmodified.** Passes.
- `CommandPalette.test.tsx` — **+17/−0**: a single appended test, every pre-existing assertion
  byte-identical. Acceptable per the brief.
- `shortcuts.test.ts` — modified for the `meta`→`mod` rename. **Legitimate**, as the brief states.
  Notably the rename edits are accompanied by genuine new coverage, not just renamed literals.

### Mutation testing (I ran these; they are the load-bearing part of this review)

| Mutation | Expected | Observed |
|---|---|---|
| `layout-undo` `shift: false` → omitted | some test red | `shortcuts.test.ts:37` **RED** ✅ … but `useLayoutUndoRedo.regression.test.ts` **stayed GREEN** ❌ (CR1) |
| delete `if (combo.shift === false && event.shiftKey) return false;` from `matchesCombo` | red | `shortcuts.test.ts:103` **RED** ✅ (1 failed / 2799 passed across the full suite) |
| neutralise `if (options.guardWhileOverlayOpen && isOverlayOpen()) continue;` in `useShortcut.ts:67` | e2e red | e2e case (f) **RED** ✅ — real-browser proof that the overlay guard is genuinely discriminating, not incidentally satisfied by the typing guard |

All mutations were reverted; `git status --porcelain` is clean.

### Issue 1 — CR1: a labelled regression guard that its own comment misdescribes

`frontend/src/features/layout/hooks/useLayoutUndoRedo.regression.test.ts:12-15` states:

> "This is failable by mutation: flipping `shortcuts.ts`'s `layout-undo` from `shift: false` to
> `shift` omitted (don't-care) makes undo don't-care about Shift, so it would also match this event
> and this test would go red."

**That claim is false.** I performed exactly that mutation; the test stayed green. The reason is that
the test's chosen scenario is non-discriminating: at the moment `mod+shift+z` is dispatched, the
handlers share one render's closure in which `undoTarget` is already `undefined` (the history was
just consumed by the preceding undo). The mutated undo binding therefore matches the event but
returns early on `!undoTarget`, the redo binding runs, and the asserted end state (`layoutB`) is
reached anyway. The mutation is silently absorbed.

I built the discriminating case and confirmed it works: with an undo target available and **no** redo
target, `mod+shift+z` must be a no-op — that variant is green unmutated and **red** under the same
mutation. Fix below.

*This does not mean the shipped behaviour is unguarded* — the identical mutation and the
`matchesCombo` mutation are both caught by `shortcuts.test.ts`. But a declaration-shape assertion is
not a behavioural guard, and a guard whose own label overstates what it proves is precisely the
evidence-shaped non-evidence this ticket binds all three roles against.

### Issue 2 — CR2: eight force-added binary PNGs (explicit judgment requested)

**My judgment: not appropriate for this repo. Remove them from the commit.**

The reasoning is not "binaries are bad" — it is that this repo's `*.png` rule is demonstrably a
*curated allowlist*, not an accident:

```
.gitignore:38  [0-9][0-9]-*.png
.gitignore:42  *.png
.gitignore:43  !docs/*.png
.gitignore:45  !docs/images/*.png
.gitignore:50  !frontend/public/pwa-*.png
.gitignore:51  !frontend/public/maskable-icon-*.png
.gitignore:52  !frontend/public/apple-touch-icon-*.png
```

Every PNG the repo has ever wanted got an explicit, narrowly-scoped negation. `openspec/**` has
none. Corroborating measurements: `git ls-files '*.png'` returned 14 files, of which **these 8 are
the entire non-allowlisted set**; and
`git log --all --diff-filter=A -- 'openspec/**/*.png'` returns **exactly one commit — this one**.
In the repo's whole history no `openspec/` change has ever carried a committed image. Force-adding
past that rule is a unilateral policy change made inside a feature commit, and it puts ~800 KB into
git history permanently (`openspec/changes/**` is archived, never deleted from history).

The evidence itself is not in question and nothing is lost: all eight are already persisted to
`.concertino/runs/HEL-510/evidence/`, which is the durable store built for exactly this. The
screenshots were good practice; committing them was the wrong destination.

### Everything else in the code review — PASS

- **DRY**: the change *removes* duplication rather than adding it — `useLayoutUndoRedo.ts`'s private
  `isEditableFocused` and `GlobalCommandShortcuts.tsx`'s own `window.addEventListener` are both
  deleted in favour of the shared guard and the single module-singleton listener. `KeyCap`'s CSS
  draws `padding: var(--space-1) var(--space-2)` from tokens and correctly does **not** hand-copy
  `padding: 2px 7px` — I verified the existing pile is unchanged at four source files
  (`PanelDetailModal.binding.css`, `PanelGrid.css`, `PipelineDetailPage.css`, `DashboardList.css`);
  the only new mention is inside `KeyCap.css.test.ts`, as the literal the guard forbids. HEL-680 gains
  no sixth entry.
- **Readable / modular**: `formatCombo` takes `{ mac }` as a parameter so both platforms are testable
  with no `navigator` stubbing — a good call. `HelpOverlay` (presentational) and `HelpOverlayHost`
  (state + wiring) are cleanly split.
- **Type safety**: no `any`. The only `as never` casts are confined to the new Redux test harness for
  store typing, a pattern already used elsewhere in this suite.
- **Comments**: substantive and decision-linked, matching the HEL-849 standard. CR1 is the one place
  a comment asserts more than the code delivers.
- **Security**: no new boundary; no user input, network call, or serialisation is introduced.
- **Error handling**: `useShortcut` throws a descriptive dev-time error for an undeclared id, which
  is what mechanically enforces the `keyboard-shortcut-declarations` spec's "no binding outside the
  declaration" rule. Covered by `useShortcut.test.ts`.
- **Dead code**: none; no leftover TODO/FIXME in the diff.
- **Behaviour-preserving migration**: the typing guard widened from `document.activeElement` only to
  `event.target ?? document.activeElement` — a strict superset, documented in-file, and the reason
  `useLayoutUndoRedo.test.ts` passes unmodified.
- **No over-engineering**: a module-level `Map` singleton rather than a React context is the right
  call and is justified in-file (it keeps provider-less hook tests working).

One design constraint worth recording for HEL-516/519/503 (not a defect today): the registry is keyed
by shortcut id, so exactly one live handler per id is supported — a second concurrent
`useShortcut("layout-undo", …)` would silently replace the first. Correct for app-global bindings;
it should be an explicit assumption when the downstream tickets add per-panel bindings.

### All new tokens verified to exist

`--app-surface-raised`, `--app-border-strong`, `--app-radius-sm`, `--weight-medium`,
`--app-focus-ring`, `--font-mono`, `--text-xs`, `--space-1`, `--space-2` — every one resolves to a
real definition in `frontend/src`. `.eyebrow` is the shared class at `theme/theme.css:313`.

---

## Phase 3: UI Review — PASS

Ran against the live app (dev `5942`, backend `8849`), logged in as `matt@helio.dev`, at 1440 / 768 /
360 widths and in **both** themes.

- **Happy path**: `?` opens the overlay from an authenticated route; five rows render under
  `GENERAL` / `LAYOUT`; `Esc` closes.
- **Both entry points**: `?` **and** the palette. Palette → type "keyboard" → the
  "Keyboard shortcuts" action appears with a `Keyboard` icon consistent with its siblings → Enter
  opens the overlay. Critically, `document.querySelectorAll('dialog[open]')` afterwards returns
  **exactly one** dialog (`ui-modal ui-modal--sm help-overlay`) — the palette closed first, so the
  `useOverlay()` single-active-overlay coordination works and modals do not stack.
- **Console**: 3 messages total, **0 errors, 0 warnings** across every flow tested.
- **Light/dark parity** (computed values, not eyeballed): dark → dialog `rgb(38,35,32)` on page
  `rgb(18,17,16)`, text `rgb(242,239,233)`, keycap `rgb(35,32,25)` with a `rgba(242,239,233,0.18)`
  border. Light → correct inverse. No hardcoded colour survives in either theme.
- **Hover/focus (HEL-866 check)**: the overlay exposes **no hover-styled surface at all** — rows and
  keycaps have no `:hover` rule — so the modal-hosted hover-token collision HEL-866 tracks has no
  attack surface here. Focus styling is the single `:focus-visible` token rule.
- **Breakpoints**: 1440 / 1100 / 768 → dialog clamps to 420 px (`Modal size="sm"`), no overflow. 360 →
  dialog 322 px wide at x=19, `document.scrollWidth === 360` (no horizontal scroll), zero row
  overflow, list fits without clipping. No layout breakage at any width.
- **Accessibility**: dialog `aria-label="Keyboard shortcuts"`; close button accessible name "Close";
  10 semantic `<kbd>` elements; Tab/Shift+Tab containment proven in Chromium by e2e case (d).
- **Cohesion verdict**: the overlay reads as a **member** of the existing modal family, not a new
  variant — same `Modal` chrome, same header/close treatment, same `.eyebrow` group label as the
  palette's `GENERAL` section header, same entrance animation (it deliberately adds none of its own).

### The 5.3 gap the executor left open — I closed it myself

Since task 5.3 was never actually exercised, I ran the missing measurement: real Chromium, real
mouse drag on the panel's real drag handle (`.panel-grid-card__handle`), then real key presses.

```
PROBE start:        t=translate(0px, 0px)     undoDis=true  redoDis=true
PROBE afterDrag:    t=translate(234px, 140px) undoDis=false redoDis=true
PROBE seen=  ["Control|ctrl=true|…", "z|ctrl=true|shift=false|tgt=BUTTON.panel-grid-card__handle|defaultPrevented=true"]
PROBE afterKbdUndo: t=translate(234px, 140px) undoDis=true  redoDis=false
```

**The keyboard binding works.** After a genuine drag, real `Ctrl+Z` reached the migrated handler
(`defaultPrevented=true`), the undo dispatched, and the history moved correctly (undo exhausted, redo
became available). The migration off the private listener is sound in a real browser.

The panel's *visual* transform did not revert, so I checked whether HEL-510 caused that. It did not:

```
PROBE afterBUTTONundo: t=translate(234px, 140px) undoDis=true  redoDis=false
PROBE afterBUTTONredo: t=translate(234px, 140px) undoDis=false redoDis=true
```

Driving undo/redo **only** through the header buttons — `app/CommandBar.tsx:111-125`, a file with a
**zero-line diff** in this commit — reproduces the identical symptom. The store updates, the grid
does not re-render to the restored layout. This is a **pre-existing bug on `main`, independent of
HEL-510**, and it is not grounds to fail this ticket. It is worth a spinoff ticket (suggestion 1).

So the executor's limitation was, on the evidence, an **honest and adequately-covered** one — the
behaviour it left unmeasured turns out to be correct. The blocking part of CR3 is only that it was
never written down and 5.3 was checked off as if fully done.

---

## Overall: FAIL

No functional defect was found in the shipped behaviour, and all four named planning defects are
genuinely fixed. The three change requests are about evidence integrity and repo policy — each is
small and none requires redesign.

## Change Requests

1. **Make the labelled regression guard actually failable by the mutation it names.**
   `frontend/src/features/layout/hooks/useLayoutUndoRedo.regression.test.ts` — the existing case is
   absorbed by the `!undoTarget` early return and stays green under the mutation its comment at
   lines 12-15 claims turns it red. Add a discriminating case (I verified this exact shape is green
   unmutated and red under `layout-undo: shift: false` → omitted): with an undo target present and
   **no** redo target, dispatch `{ key: "z", ctrlKey: true, shiftKey: true }` and assert the layout
   is **unchanged**. Then correct the comment so it describes the case that actually carries the
   proof rather than the one that does not.

2. **Remove the eight PNGs from the commit.**
   `git rm --cached openspec/changes/keyboard-shortcut-help-overlay/screenshots/*.png`, drop the
   directory, and amend. Replace the last bullet of `files-modified.md` with a pointer to the durable
   copies under `.concertino/runs/HEL-510/evidence/` instead of to committed paths. Do not re-add
   with `-f`; if committed visual evidence is ever wanted in `openspec/`, that needs its own
   `.gitignore` negation and an owner decision, not a per-commit override.

3. **Make the 5.3 deferral real, or mark 5.3 honestly.**
   `tasks.md` 5.3 is `[x]` but its stated verification (a layout change reverted and reapplied) was
   never performed, and the limitation is recorded nowhere in the commit. Add a short
   "Known limitation / evidence" entry to `files-modified.md` stating exactly what was and was not
   exercised. You may cite this report's real-browser probe above as the measurement that closes it —
   in which case 5.3 stands satisfied and only the write-up is owed.

## Non-blocking Suggestions

- **File a spinoff bug for the pre-existing undo/redo visual-revert defect.** Layout undo/redo
  updates the store and the history correctly but the grid does not visually revert — reproduced via
  the untouched header buttons in `app/CommandBar.tsx`, so it predates this ticket. It is a real
  user-visible product bug and currently has no owner. Do **not** fix it inside HEL-510.
- **`Modal.css:135-138`'s comment is factually wrong in a real browser.** It claims the title's
  focus treatment is a "No-op for every other (never-focused) consumer's title". In fact
  `<dialog>.showModal()` focuses the first focusable descendant, and `<h2 tabIndex={-1}>` qualifies —
  so any Modal whose body has no focusable content opens with a full `--app-focus-ring` around its
  heading, which reads like a text input. The help overlay is such a consumer, and it looks slightly
  off at rest because of it. I proved this is structural to `Modal`, not to HEL-510, with a synthetic
  dialog of the same DOM shape in the live page (focus landed on the probe `<h2>`, `:focus-visible`
  matched). The palette avoids it only because its search input autofocuses. Worth a spinoff against
  `shared/ui/Modal`; explicitly **out of scope here** — do not hack around it locally in
  `HelpOverlay.css`.
- In dark theme the keycap surface (`--app-surface-raised`, `rgb(35,32,25)`) is marginally *darker*
  than the modal surface it sits on (`rgb(38,35,32)`), so a cap reads as recessed rather than raised.
  It is legible thanks to the border and it is a correct token choice; flagging only as a
  design-language observation for the skeptic's judgment call.
- Consider having e2e case (d) actually press Shift+Tab — the test is titled
  "Tab/Shift+Tab stay inside the overlay" but only presses Tab. The containment claim holds either
  way (Chromium wrap is exercised in both directions by `Modal`'s own trap tests), so this is cosmetic
  accuracy in the test name, not a coverage hole.
