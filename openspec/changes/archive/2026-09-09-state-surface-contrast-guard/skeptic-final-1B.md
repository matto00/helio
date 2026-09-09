## Skeptic Report — final gate (round 1B, skeptic-final-1B.md)

Second, independent final-gate reviewer. Verdict reached without reference to the
parallel reviewer's conclusions. HEAD `a760e098`.

### What I verified (with evidence)

**Ground truth / servers.** `start-servers.sh` reported both ports already healthy
(reused), so I did NOT trust the port. `assert-phase.sh servers` → `PASS servers`, and I
self-authenticated the served bundle: `curl http://localhost:6298/src/app/App.css`
returns this branch's `HEL-866` comment block and the
`:root[data-theme="dark"] .app-command-bar__logo:hover` rule, and
`SourceListTable.css` returns the cycle-3 `1.161` comment. The dev server is serving
THIS worktree. Theme tokens read live from the running app confirm the ticket's premise:
light `raised == strong == #ffffff`.

**Rendered walk, both themes** (screenshots in
`.concertino/runs/HEL-866/evidence/skeptic1B/`, `location.href` + `data-theme`
re-checked before every reading; the shared tab was stolen twice by the parallel
session and re-established each time):

| surface | light | dark | reading |
| --- | --- | --- | --- |
| command palette active row (the original defect site) | `light-palette-active.png` | `dark-palette-active.png` | clearly visible both; AC1/AC3 met here |
| modal close button (palette) | `light-modal-closehover.png` | — | visible fill + border on white |
| AddSourceModal type tab hover | `light-addsource-tabhover.png` | `dark-addsource-tabhover.png` | visible both; real modal, not just the palette |
| UserMenu popover item | `light-usermenu-hover.png` | — | measured `#efece6` on `#ffffff` panel, visible |
| sidebar nav link | `light-sidebar-navhover.png` | `dark-sidebar-navhover.png` | visible both (dark subtle but present) |
| sidebar active nav link `.active:hover` | `light-sidebar-activehover.png` | — | accent-mid step is real and on-brand |
| SourceListTable row (family 3) | `light-sourcetable-rowhover.png` | `dark-sourcetable-rowhover.png` | visible both; CR6's regression is genuinely repaired — measured live `#232019` on `#121110` = **1.161**, matching the claim |
| command-bar ActionsMenu trigger (light `popover__trigger` override) | `light-cmdbar-actionshover.png` | — | measured live hover bg `rgb(239,236,230)` on bar `rgb(253,252,250)` — the override does fire |

**AC4 / theme.css.** `git diff main...HEAD -- frontend/src/theme/theme.css` → **0 lines**.
No token added, no value changed. The recommendation IS recorded in `DESIGN.md` §3 with
the three measured backdrop families as evidence and an explicit "Still recommended,
still not adopted this run — owner sign-off required". **AC4 met.**

**Guard population, read from the persisted cycle-3 log:**
`elements probed: 360, resolved=360, unresolved=0, pass=148, fail=20, advisory=192`
(the 20 fails are exactly the 20 reviewed exemptions).

**Guard scoping, read from the spec source** (`e2e/state-surface-contrast-guard.spec.ts:495-524`):
the `chrome` view is scoped to `.app-command-bar, .app-sidebar__nav-row`, with
`.app-sidebar` itself deliberately rejected as a scope root; every route view is scoped
to `page.locator("main")`.

### Verdict: REFUTE

The mechanism, the mutation proof, the family-1/family-3 remediation and AC4 all hold up
under independent check. But the rendered walk found a **live, reproduced instance of the
ticket's own defect class, newly created by this diff** — the same shape as
evaluation-2.md CR6, in a surface the guard cannot see by construction.

### Change Requests

1. **The sidebar dashboard list was regressed by this diff, in dark theme — CR6 all over
   again, un-remeasured.** `frontend/src/features/dashboards/ui/DashboardList.css:477`
   (`.dashboard-list__button:hover`) was swapped `--app-surface-raised` →
   `--app-surface-soft`. That element's real backdrop is `.app-sidebar`, which paints
   `--app-surface` (measured live: `rgb(26, 24, 22)`) — it is **family 2, not family 1**,
   but `files-modified.md` lists `DashboardList.css` under family 1
   ("`--app-surface-strong` … confirmed still correct") and it received no dark override.
   Measured live in the running app (dark), computed with the guard's own WCAG formula:

   | | state colour | ratio vs `.app-sidebar` `rgb(26,24,22)` |
   | --- | --- | --- |
   | **shipped (this diff)** | `--app-surface-soft` `#161514` | **1.030 — FAILS the guard's own 1.10 threshold** |
   | before (on `main`) | `--app-surface-raised` `#232019` | 1.089 |
   | family-2 rule applied | `--app-surface-strong` `#262320` | 1.133 — passes |

   Reproduced twice (once via live hover + `getComputedStyle`, once deterministically
   from the resolved token values against the live sidebar background, after the shared
   tab was stolen mid-measurement). Rendered confirmation:
   `dark-sidebar-dashrow-hover-REGRESSION.png` — the hovered row shows **no perceptible
   background band at all**; only the text colour brightens. Compare
   `light-dashlist-rowhover.png`, where the same state shows a clear band. This is the
   app's primary navigation list, and the change moved it *away* from the threshold.

   The same swap with the same missing dark override, on the same `.app-sidebar`
   backdrop, applies to three sibling rules in that file — all four need re-deriving
   against their real backdrop, not the family-1 assumption:
   - `DashboardList.css:104` `.dashboard-list__filter-clear:hover`
   - `DashboardList.css:320` `.dashboard-list__row-action-btn:hover`
   - `DashboardList.css:721` `.dashboard-list__import-label:hover`

   (`.dashboard-list__item-row .actions-menu__trigger:hover` at :280 IS rescued, by
   `App.css:728`'s higher-specificity `.app-sidebar .actions-menu__trigger` dark
   override — that one is fine. Note `DashboardList` also renders inside
   `MobileNavSheet`, whose container is `--app-surface-strong`, so the fix likely needs
   `.app-sidebar`-scoping rather than a blanket dark override; please measure both hosts
   rather than assuming.)

2. **The guard has a structural blind spot that hid CR1 — the sidebar's content rail is
   in no view.** `e2e/state-surface-contrast-guard.spec.ts:495-524` scopes the `chrome`
   view to `.app-command-bar, .app-sidebar__nav-row` (explicitly rejecting `.app-sidebar`
   as a root) and every route view to `page.locator("main")`. Everything in the sidebar
   below the nav row — the entire `.dashboard-list` (rows, filter, filter-clear, row
   actions, import label) — is therefore matched by **neither**, on every route, in both
   themes. Four of this diff's changed rules live exclusively in that gap, which is why a
   green 360-element run certified a 1.030 regression. Bring that rail into the
   enumerated population (a third `sidebar-rail` view probed once per route, or per
   theme with the route recorded, resolving the "wrong route's rail" concern the current
   comment raises) — otherwise the guard cannot catch the next instance of exactly this
   bug either, which is AC5's whole point.

3. **`files-modified.md`'s guard-run summary overstates coverage — report the
   pass/advisory split.** It records the cycle-3 run as "360 elements probed,
   resolved=360/unresolved=0, 20 reconciled exemptions, green". The log's own line is
   `pass=148, fail=20, advisory=192` — the guard **asserts** on 148 of 360 probes (41%);
   192 are advisory (largely focus-via-outline) and gate nothing. "360 probed … green"
   reads as coverage the run does not have. State `148 asserted / 192 advisory / 20
   exempt of 360`, plus the view-coverage bound already noted in design.md D6.2 (and the
   1-element contributions from `/connectors` and `/chat`), in `files-modified.md` and in
   the PR body, so AC2's "complete sweep" claim is bounded honestly where a reader will
   see it.

4. **`DESIGN.md:561` now contradicts the shipped code.** The sticky-column-table recipe
   says "`--app-surface-soft` still matches the row's own hover treatment (HEL-866)".
   Cycle 3 reverted table rows to `--app-surface-raised` (`SourceListTable.css:57`,
   `AuditEventTable.css:43`, `PipelinesPage.css:25` — family 3). This is a leftover from
   the cycle-2 "always soft" claim that §3 was rewritten to retract. As written it would
   steer the next implementer to `soft` on an `--app-bg` backdrop — precisely the
   regression this ticket created and then had to undo. Change to
   `--app-surface-raised`, or point at §3's family table.

### AC status as verified

- **AC1** — met for every modal/popover/menu-hosted state I rendered, both themes.
- **AC2** — **not met as stated.** The sweep misclassified `DashboardList.css`'s backdrop
  family (CR1), and the recorded result overstates the guard's assertion coverage (CR3).
- **AC3** — met where measured (dark contrast is real: 1.16–1.18 on modal interiors,
  1.161 on canvas rows), **except** the CR1 sites, which sit at 1.030 in dark.
- **AC4** — **met.** `theme.css` untouched; recommendation recorded and explicitly
  declined pending owner sign-off.
- **AC5** — the guard is real, rendered, CI-wired and mechanically enumerated, but its
  input set excludes a whole visible surface (CR2), which is what let CR1 through.

### Non-blocking notes

- **Cross-family direction inconsistency is real but, I judge, not blocking.** Within one
  theme the three families move in opposite directions: in light, a table row hovers
  *lighter* (raised, on `--app-bg`) while a sidebar link and a menu row hover *darker*
  (soft); in dark, a modal row recesses while a chrome button raises. On `/sources` both
  behaviours are visible on screen simultaneously. Each state is individually legible and
  low-chroma, and there is no rung above `#ffffff` in light, so this is not fixable inside
  the ticket's "no `theme.css` change without sign-off" constraint. It is exactly the
  argument DESIGN.md now makes for `--app-state-hover`/`--app-state-selected`; I'd weight
  that recommendation as the real fix rather than blocking on it here.
- In the light AddSourceModal, the hovered type tab's fill (`#efece6`) is byte-identical
  to the resting fill of the inputs directly above it, so a hovered tab momentarily reads
  as an input well. Cosmetic; same underlying "one rung serving two jobs" cause as above.
