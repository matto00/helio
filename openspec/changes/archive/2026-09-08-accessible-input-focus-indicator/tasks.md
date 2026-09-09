# Tasks

## 1. Re-derive the inventory from the tree (do not trust design.md's table)

- [x] 1.1 Run `git grep -n "outline:\s*none" -- 'frontend/src/**/*.css'` and confirm the count is 11. If it
      differs, the tree moved — reconcile before editing anything.
- [x] 1.1a **Establish RENDERED instances, not grep hits.** For every site, resolve its selector to real
      markup in `frontend/src` (a `.tsx` reference, not another stylesheet). The ticket's constraint is
      "size from rendered instances, not grep counts", and a grep-only inventory already produced one wrong
      entry: site 9 (`add-source-modal__cell-input`/`cell-select`) has **zero** markup references and is
      excluded per D9. Any other site that resolves to zero markup gets the same treatment — record it,
      do not edit it.
- [x] 1.2 For each site, record the mechanism actually conveying focus (border / box-shadow / border-bottom)
      and whether the `outline: none` is a base rule or inside a focus state.
- [x] 1.3 Confirm site 6 (`DashboardList.css:687`) has a **permanent** accent border, so focus is conveyed
      only by the halo. If that is wrong, D2's remedy for it is wrong.

## 2. Resolve the ticket's 1.63:1 discrepancy by measurement

- [x] 2.1 Start the dev servers via `scripts/concertino/start-servers.sh` on the ports in
      `workflow-state.md` (dev 6482, backend 9389).
- [x] 2.2 **Self-authenticate the server before observing anything visual:** `curl` the dev port for a string
      that exists only on this branch and confirm it is served. Do not use a TypeScript type as the probe —
      Vite strips types. A port check is not sufficient; another lane's Vite may hold this port.
- [x] 2.3 Measure `PipelineDetailPage.css:796`'s footer-output-input base border by computed style in **dark**
      theme. Confirm or refute the 1.644 hypothesis. **Record the result either way** — a refuted hypothesis
      is a finding, not a failure.
- [x] 2.4 Measure `inputs.css`'s focused border in light and record the actual figure. If it is not in
      2.38–2.80, the model in design.md is wrong and must be corrected before proceeding.

## 3. Apply the fix, per mechanism

- [x] 3.1 `shared/ui/inputs.css:39` — `border-color` to `var(--app-focus-ring-color)`. Keep the halo (D2).
- [x] 3.2 `DashboardList.css:75`, `:144`, `:355` — same treatment.
- [x] 3.3 `DashboardList.css:687` (site 6) — **add** a conforming `border-color: var(--app-focus-ring-color)`
      to the focus state. The halo alone cannot satisfy the floor.
- [x] 3.4 `auth.css:107/113` — `border-color` to the ring token, and convert bare `:focus` to
      `:focus-visible` (D6).
- [x] 3.5 `PanelGrid.css:244` (site 7) — `border-bottom-color` to `var(--app-focus-ring-color)`. Keep
      `border-bottom` as the mechanism; do not reinstate an outline (clipping — D1). **This site's binding
      surface is user-chosen (D8), so the token does NOT guarantee 3:1 here.** Add a code comment at the site
      recording that the residual non-conformance is owned by **HEL-1051** — the fix is a strict improvement,
      not a closure.
- [x] 3.6 `PipelineDetailPage.css:803/805` — ring token; convert bare `:focus` to `:focus-visible`.
- [x] 3.7 `AddSourceModal.css:156/160` (site 9) — **do not edit.** Orphaned CSS, zero markup references
      (D9); owned by **HEL-1052**, filed specifically for it. (It is *not* HEL-1049's: that ticket is entirely
      `PanelDetailModal.binding.css`/HEL-909-scoped, so deferring here would have rested on an assumption.)
      Editing dead CSS manufactures the appearance of coverage.
- [x] 3.8 `AccentPicker.css:36` — ring token in the focus shadow, **and** make the focused state visually
      distinct from `--selected`, which currently declares a byte-identical `box-shadow`. Both defects or
      neither; fixing the colour alone leaves the swatch ambiguous.
- [x] 3.9 Do **not** touch `PanelDetailModal.binding.css:137` — HEL-1049 owns it as orphaned CSS.

## 4. Guard

- [x] 4.1 Extend `frontend/src/theme/focusRingTokenGuard.css.test.ts` per **D5**, at **selector-base**
      granularity: normalise each selector by stripping trailing pseudo-classes, group declarations by base,
      and for every base declaring `outline: none` anywhere in its group, require some rule in that group
      carrying `:focus-visible` to declare a conforming indicator. A same-rule check is wrong — it would go
      red on all four correctly-fixed base-rule sites. Pins (where genuinely needed) match {file, exact
      normalised text, exact count}, per HEL-442's construction.
- [x] 4.1b Add the **one** required pin: `.add-source-modal__cell-input, .add-source-modal__cell-select`
      (`AddSourceModal.css:156`) declares `outline: none` on the base rule with only a bare `:focus` sibling,
      so it fails 4.1's check and D9 forbids editing it. Pin on {file, exact normalised selector text, count 1}
      with reason "orphaned CSS, zero markup references" and owner **HEL-1052**, and state in the guard that
      **HEL-1052 deletes this pin** — it is a temporary owned exception, not a permanent hole.
      `PanelDetailModal.binding.css` needs no pin (it has no `outline: none`).
- [x] 4.1a Implement the **two-part conforming predicate** (D5), over the enumerated property set `outline`,
      `outline-color`, `border-color`, `border-{top,right,bottom,left}-color`, `box-shadow`:
      (1) at least one indicator declaration **in some `:focus-visible` rule of the group** references
      `var(--app-focus-ring-color)`/`var(--app-focus-ring)`;
      (2) no indicator declaration **in a focus rule** references bare `var(--app-accent)`, where "focus
      rule" is decided on the **raw selector with every `:not(…)`'s contents removed first**, then tested for
      `:focus`/`:focus-visible`. Match the negation as **`:not\([^()]*\)` (non-greedy, no nested parens)** — both
      greediness choices are correct for the two selectors that exist today, but a greedy `:not\(.*\)` would
      be wrong for a `:not(.x):focus` shape. **Do not use a naive `selector.includes(":focus")`** — `PanelGrid.css:238`'s
      `:hover:not(:disabled):not(:focus)` contains that substring inside a negation, which readmits the
      untouched hover rule and turns the guard red on task 3.5's own remedy. **Do not apply the test to the
      base-normalised selector either** — then no rule carries `:focus` and part (2) is vacuously green.
      **The asymmetry is deliberate — do not "simplify" part (2) to the whole group.** Group-wide, it goes red
      on `PanelGrid.css:239`'s untouched *hover* `border-bottom-color: var(--app-accent)`, rejecting task 3.5's
      own remedy. Do not instead stop stripping `:not(…)` — that hides the collision at the cost of D4's check.
      Also split comma-separated selector lists **before** normalising (`inputs.css:36-38` is a three-selector
      list).
      `border-bottom-color` must be in the set or the guard rejects task 3.5's own remedy. Part (1) must
      exist or the retained `--app-accent-dim` halo makes the guard vacuous.
- [x] 4.2 **Verify the mutation actually lands, three ways** — confirm the guard goes red *for the stated
      reason* each time, not merely red:
      (a) **add** a bare `var(--app-accent)` indicator declaration *alongside* the retained ring declaration
      in a fixed focus rule (must fail part 2 **alone**). Note that merely *reverting* a site's declaration
      from the ring token to `var(--app-accent)` removes the ring reference too, so it fails part (1) as well
      and does not isolate part (2) — this arm exists to prove part (2)'s token matching is not silently
      matching nothing;
      (b) delete the ring-token declaration from a focus rule, leaving only the `--app-accent-dim` halo
      (must fail part 1 — this is the vacuity check, and the most likely meaningless green);
      (c) add a base rule with `outline: none` and no sibling `:focus-visible` indicator (must fail the
      selector-base check);
      (d) **a green-assertion arm, not a red one:** with task 3.5 correctly applied, the guard must be
      **green** while `PanelGrid.css:238`'s untouched hover `border-bottom-color: var(--app-accent)` is
      present. Under a naive substring implementation of part (2)'s scope test this flips red, so this arm is
      what actually pins the `:not(:focus)` handling. Confirm it fails if you deliberately swap in the
      substring implementation — otherwise this arm proves nothing either.
      A guard whose pattern silently fails to match returns a meaningless green; vacuity has a level above
      the test.
- [x] 4.3 Add a per-preset assertion that `--app-accent-strong` is **not** a conforming focus colour, per
      **D5a**: **parse the mix percentage and base colour out of `theme.css`'s `--app-accent-strong`
      declaration** and evaluate that two-colour sRGB mix over the 8 presets. **Do not hardcode 2.78** — it
      drifts silently if `76%`/`black` changes, the class of defect HEL-1046 answered by re-parsing
      `theme.css`. Assert Yellow is the failing preset and that at least one preset fails, so the assertion
      cannot pass vacuously if the parse returns nothing.
- [x] 4.4 State the guard's limitations **in the guard**, worded so they are not contradicted by 4.3: it
      reasons about CSS text; it CAN evaluate a simple two-colour sRGB mix **that it has parsed from
      `theme.css`**; it CANNOT evaluate arbitrary runtime composition, see inline-styled or runtime-composed
      indicators, or detect a conforming value hidden behind a non-conforming token name. Round 1's wording
      ("cannot evaluate `color-mix`") would have made the guard's own comment false.
- [x] 4.5 Confirm HEL-1046's existing focus-ring guard still passes unmodified (AC-2).

## 5. Verify on the running app — all 8 presets, both themes

- [x] 5.1 Drive the real `AccentPicker` to change accent. **Do not write `localStorage`** — accent is
      server-preference-backed, so that exercises the wrong path.
- [x] 5.2 Allow a long settle before reading computed style. A 800–1200ms probe reads the dead `#ea580c` and
      will appear to confirm a claim that is false.
- [x] 5.3 For each of the 8 presets × 2 themes, focus a representative of each mechanism and record **two
      things the arithmetic cannot supply**: (i) the colour actually **painted** at that element — proving the
      token resolves and the raw accent is not what renders — and (ii) the element's **measured adjacent
      background**, proving it is a surface the derivation actually covers. Contrast is then computed from
      those two measured values. Re-deriving ratios alone mostly re-proves arithmetic already guarded.
- [x] 5.3a **Measure site 7 on a NON-DEFAULT panel appearance** — a user-chosen panel background near the
      derived ring colour, and again at low transparency so the dashboard background shows through. This is
      the case D8/HEL-1051 names, and the 8×2 sweep above is entirely silent on it: a test that varies the
      accent but not the surface cannot find a defect whose variable is the surface. Record the number;
      a sub-3:1 result here is expected and documented, not a new failure — but see 5.4 for the exact,
      narrow limits of that exemption.
- [x] 5.4 Assert every measured ratio ≥ 3.0. Any value below is a failure of AC-1, not a rounding matter.
      **Exactly one narrow carve-out, and nothing else:** site 7 (`PanelGrid.css` title input) measured on a
      **non-default panel appearance** per 5.3a may fall below 3.0 — it must still be recorded as a number in
      `.concertino/runs/HEL-1050/evidence/` with the HEL-1051 reference. Site 7 on **default** appearance is
      **not** exempt and must clear 3.0. Any other sub-3.0 value fails AC-1. (5.3a's "expected" framing must
      not be readable as a licence to wave through an unrelated failure.)

## 6. UI cohesion (first-class gate)

- [x] 6.1 Compare focused inputs against the **running app's current visual state**, both themes — not
      against `DESIGN.md` alone. Token compliance is necessary but not sufficient.
- [x] 6.2 Check hover **and** focus, and confirm focus remains distinguishable from hover and from the
      `aria-invalid` error state (which uses `--app-error` with the same halo recipe).
- [x] 6.3 Screenshots to `.concertino/runs/HEL-1050/evidence/` only. Never into `openspec/**`, never
      `git add -f` past the ignore.
- [x] 6.4 If cohesion requires touching a surface beyond this scope, **do not widen the diff and do not ship
      the incohesive version** — escalate with screenshots. The owner is tiebreaker.

## 7. Documentation

- [x] 7.1 `DESIGN.md` §8 — record that the obligation binds on whichever mechanism conveys focus, that the
      dim halo is decoration and never credited, and that `--app-accent-strong` is disqualified with the
      Yellow figure that disqualified it.
- [x] 7.2 `frontend/src/theme/appearance.ts` — record beside `deriveFocusRingColor` the corrected
      binding-surface derivation **and why the palette extremes are wrong** (D7, owner-instructed).

## 8. Gates and handoff

- [x] 8.1 `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check` from `frontend/`.
      **Root `npm test` is `jest --passWithNoTests && npm --prefix frontend test`** — inside a worktree root
      it finds zero tests and turns silence into a pass. Run the frontend suite explicitly.
- [x] 8.2 `npm run check:tokens` — every `var(--*)` must resolve (HEL-1037).
- [x] 8.3 Write `files-modified.md` as **one bullet per file with the full path from the repo root**.
      Continuation lines and abbreviated names have been rejected by the squash guard twice on this batch.
- [x] 8.4 Commit before yielding. An uncommitted handoff is an incomplete one.
- [x] 8.5 Name every site left unfixed with its reason and owning ticket (AC-4). Silent omission fails.
      Known at planning time: **site 9** (`AddSourceModal.css`) — orphaned, **HEL-1052** (plus its guard pin, which HEL-1052 deletes); **site 7's
      user-chosen-surface residual** (`PanelGrid.css`) — structurally unfixable by a colour, HEL-1051;
      **`PanelDetailModal.binding.css:137`** — orphaned, HEL-1049.
