## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold spawn. Every claim below derived from the tree at `4284ca15` and from Linear directly, not
from design.md's narrative or from rounds 1–2's reports. Arithmetic deliberately not re-derived a
third time (per instruction); nothing I read contradicts it.

### What I verified (with evidence)

- **Inventory.** `git grep -nE "outline\s*:\s*(0|none)" -- '*.css'` in `frontend/src` returns
  exactly **11** hits, all `none`, matching design.md's table file-for-file. No `outline: 0`
  variant hides a twelfth site.
- **D5 walked against all ten live base groups**, reading each rule region:
  `inputs.css:30-42`, `auth.css:99-116`, `DashboardList.css:73-78/143-148/354-359/675-690`,
  `PanelGrid.css:222-248`, `PipelineDetailPage.css:790-808`, `AccentPicker.css:12-45`,
  `AddSourceModal.css:150-163`. Result below (CR-1 is the one break).
- **Item 2 — is one pin sufficient?** The 11 `outline: none` hits resolve to **10 selector-base
  groups**: `.ui-input`/`.ui-select__trigger`/`.ui-textarea` (one three-selector list),
  `.auth-field input`, four `DashboardList` inputs, `.ui-input.panel-grid-card__title-input`,
  `.ui-input.pipeline-detail-page__footer-output-input` (its `:796` base + `:805` focus rule are
  the *same* group), `.add-source-modal__cell-input, …__cell-select`, `.accent-picker__swatch`.
  After tasks 3.1–3.8 land, **every one of these except AddSourceModal has a `:focus-visible` rule
  declaring the ring token**, so part (1) holds and no second pin is needed. Two adjacent
  near-misses I checked and cleared: `.accent-picker__swatch--selected` (`AccentPicker.css:41`,
  bare-accent `box-shadow`) normalises to its **own** base — `--selected` is a class-name suffix,
  not a trailing pseudo-class — so it is neither an `outline: none` group nor a focus rule;
  and `.dashboard-list__rename-input`'s permanent `border: 1px solid var(--app-accent)`
  (`DashboardList.css:678`) uses the `border` **shorthand**, which is deliberately *not* in D5's
  enumerated indicator-property set, and sits on a base rule regardless. **One pin is correct.**
- **Item 3 — deferral targets read in full in Linear.**
  - **HEL-1052** (Backlog/Low, filed 2026-09-08) is genuinely scoped to
    `AddSourceModal.css:146-161`, states the zero-hit grep, explains why HEL-1050 neither fixes nor
    deletes it, and carries an explicit AC: *"HEL-1050's guard pin for `AddSourceModal.css` is
    removed (dead) or replaced by a passing fix (live). It does not survive this ticket in either
    case."* **It owns the pin deletion, as D5/task 4.1b claim.** Round 2's CR-3 is properly fixed.
  - **HEL-1051** (Backlog/Medium) covers exactly D8's residual — user-chosen
    `--panel-surface-override`, the low-alpha show-through case, three candidate mechanisms, and an
    adversarial-background AC. It imports none of HEL-1048's accent-as-text scope. Real deferral.
- **Item 4 — `extractThemeBlock` exists and behaves as D5a assumes.**
  `focusRingTokenGuard.css.test.ts:35-42`, regex
  `:root\[data-theme=["']X["']\]\s*\{([\s\S]*?)\n\}`, throwing on no match. Already used by
  `readAllSurfaces` (`:65-66`). **Light/dark attribution is right:** `theme.css:171`
  (`78%, white`) sits in the block whose sibling declares `--app-accent: #f97316` and whose comment
  says *"See also the light block's copy below"* — it is the **dark** block; `:222`
  (`76%, black`, alongside `--app-accent: #ea580c`) is **light**. D5a's per-theme parse and its
  "Yellow-fails is a light-theme claim about the 76%/black mix" framing are correct.
- **Item 5 — task 5.4's carve-out.** Exactly one exemption, triple-bounded (site 7 only /
  non-default panel appearance only / must still be recorded as a number with the HEL-1051 ref),
  with site 7 on default appearance explicitly non-exempt. AC-1 stays assertable: 8 presets × 2
  themes × every mechanism must clear 3.0. Not abusable. No objection.

### Verdict: REFUTE

**One** blocking item. It is **category (c) — a defect introduced by the round-2 fix**: round 2's
CR-1 asked for part (2) to be scoped to focus rules, that scoping was written, and the wording
chosen is defeated by the very selector CR-1 was about. It is *not* a repeat of an unfixed item
(round 2's five CRs are each genuinely addressed), and it is cheap to close.

### Change Requests

1. **[category (c)] D5/task 4.1a's part-(2) scope test — "a rule whose selector carries `:focus`
   or `:focus-visible`" — is defeated by `:not(:focus)`, and re-lands round 2's CR-1 on the same
   declaration.**

   `PanelGrid.css:238` is
   `.ui-input.panel-grid-card__title-input:hover:not(:disabled):not(:focus) { … border-bottom-color: var(--app-accent); }`.
   That selector **literally contains the substring `:focus`** — inside a negation. The obvious
   implementation of the new scope test (`selector.includes(":focus")`) therefore admits this
   *hover* rule into part (2)'s scope, its `border-bottom-color: var(--app-accent)` violates part
   (2), and the guard goes red on the ticket's own remedy for task 3.5 — **exactly the failure
   round 2's CR-1 identified, reached through the new wording instead of the old one.** The likely
   implementer response is to weaken the guard, which is the outcome D5 spends two paragraphs
   trying to prevent.

   The alternative reading is no better: if an implementer applies the scope test to the
   **normalised** selector (pseudo-classes already stripped), then *no* rule carries `:focus`,
   part (2) is vacuously satisfied everywhere, and the guard returns a meaningless green — the
   second failure mode D5 explicitly worries about for part (1).

   **Required revision.** State in D5 and task 4.1a that part (2)'s scope test is evaluated on the
   **raw selector with the contents of every `:not(…)` removed first**, and only then tested for
   `:focus`/`:focus-visible`; i.e. a rule matching only when *not* focused is never a focus rule.
   Say why (`:not(:focus)` contains the substring), and say that the test must not be applied to
   the base-normalised selector. Add a third mutation arm to task 4.2 that pins this down: with
   task 3.5 correctly applied, the guard **must be green** while `PanelGrid.css:238`'s untouched
   hover `border-bottom-color: var(--app-accent)` is present — a green that would flip red under
   the substring implementation.

   (`PipelineDetailPage.css:799`'s `:hover:not(:disabled):not(:focus)` has the same shape but
   declares `var(--app-accent-mid)`, so it is currently harmless — it is a second instance of the
   pattern, not a second failure.)

### Non-blocking notes

- **Task 3.6 is not literally executable as written.** `PipelineDetailPage.css:803-804` is a
  two-selector list that *already* contains the `:focus-visible` twin:
  `….footer-output-input:focus, ….footer-output-input:focus-visible {`. "Convert bare `:focus` to
  `:focus-visible`" yields a duplicated selector. Reword to "**delete** the bare `:focus` selector
  from the list, leaving the `:focus-visible` one". Note also that the guard cannot catch a
  half-done D6 here: after the colour fix that rule declares the ring token either way, so part (2)
  stays green with the bare `:focus` left in. Worth one line in task 3.6 so it is not left to the
  evaluator.
- D5 does not say whether selector-base grouping is per-file or global. It makes no difference on
  the current tree (`.ui-input` and `.ui-input.panel-grid-card__title-input` are distinct base
  strings), and the pin shape is `{file, text, count}` which implies per-file. Fine to leave, but
  per-file is the reading to implement.
