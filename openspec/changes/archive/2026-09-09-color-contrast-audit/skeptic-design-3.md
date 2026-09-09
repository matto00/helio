## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Cold spawn; every number below re-derived by me from `frontend/src/theme/theme.css`
source with a plain WCAG-formula script, not adopted from any prior report.

**Token source read** (`theme.css:205-250`, light block): `--app-text #211d19`,
`--app-text-muted #6c655c`, `--app-success #1a7f4e`, `--app-warning #99621e`,
`--app-error #c73a2a`; surfaces `#f4f2ed / #fdfcfa / #efece6 / #ffffff / #ffffff`;
intent tints `success 11% / warning 11% / error 10%`; accent tints
`accent-surface 11% / accent-dim 8% / accent-mid 26% / bg-accent 5% / bg-secondary 3%`.

1. **Round 2's figures reproduce exactly.** `--app-text-muted` on the success /
   warning / error tints over `--app-surface-soft` = **4.252 / 4.265 / 4.249**
   (plan says 4.25 / 4.27 / 4.25 — correct).
2. **The degradation claim reproduces.** I independently darkened each intent
   token until it cleared 4.55 against its worst backdrop including its own tint
   (landing near `#176e44` / `#87561a` / `#b13425`) and re-measured muted over the
   *new* tints: **4.191 / 4.209 / 4.209** (plan says ~4.19 / 4.21 / 4.21 — correct).
   D8's premise is real and correctly quantified.
3. **`#676057` checked directly.** Against every neutral surface and every
   *current* tint composite its worst is **4.583** (error tint over
   `--app-surface-soft`); vs `--app-text` it is **2.70:1**, so still a visibly
   muted step. The claim as literally written is true.
   **But** against the *post-task-3.1* darkened tints — the state that actually
   exists after this change — its worst is **4.521 / 4.539 / 4.540**. It clears
   4.5 but does **not** reach the plan's own stated `>= 4.6` target. `#666057`
   reaches 4.599-4.616 on today's tints and `#645d55` gives 4.73-4.75 on the
   darkened ones. Task 3.4a's binding instruction is the target (">= 4.6"), not
   the hex ("approximately `#676057`"), and 3.4 forces a post-edit re-measure, so
   this is an accuracy nit rather than a defect — noted below, not a CR.
4. **D8's option-3 rejection: right conclusion, partly wrong reason.** I read
   `DESIGN.md` §3. The opacity invariant there prohibits *translucent structural
   surfaces* (`--app-surface*` are opaque; carve-outs for the overlay scrim and
   `BottomNav`). Nothing in §3 pins the intent washes' 10%/11% percentages, so
   "the tint opacities are exactly the surface/opacity invariants DESIGN.md §3
   protects" is an over-claim. D8's *second* reason is sound on its own: the change
   would repaint every intent wash app-wide to fix three pairs, which is the
   visual-identity class HEL-1048 established needs sign-off. Conclusion stands.
5. **Closure question (round 3's real finding).** Extending the backdrop set does
   expose a further tier, and it is not hypothetical. The accent-derived
   semi-transparent tokens are used as backgrounds in component CSS:
   `--app-accent-surface` 24 sites, `--app-accent-dim` 10, `--app-accent-mid` 5
   (`OutputsRail.css:100`, `PipelineDetailPage.css:160,491`, `DashboardList.css:526`,
   `App.css:365`), `--app-overlay` 3; `--app-bg-accent` / `--app-bg-secondary` 0.
   18 of the `--app-accent-surface` sites set a `color:` within 4 lines.
   Measured over `--app-surface-soft` with the light accent: `--app-text-muted` on
   `--app-accent-mid` = **3.63**, intent tokens **3.17-3.26** — materially worse
   than anything this plan addresses. `--app-text` is fine everywhere (worst 10.57),
   so that half of the question is closed.
   Partial mitigation already exists: `accentTextSourceSyncGuard.css.test.ts:51-63,150-156`
   already composites `--app-accent-surface`/`--app-accent-dim` over all five
   neutrals for all 8 presets — but only for the `--app-accent-text` foreground,
   and it does **not** cover `--app-accent-mid` at all.
   This is where the plan needs a stated boundary rather than another tier, and it
   currently contradicts itself about where that boundary is — see CR1.

### Verdict: REFUTE

One narrow, cheap revision. Everything else in the plan is sound and I would not
spend a further round on it.

### Change Requests

1. **State the backdrop-set boundary explicitly, and reconcile the spec delta with
   the tasks.** `specs/accessible-token-contrast/spec.md:11` writes the obligation as
   "the semi-transparent `--app-*-surface` tints" — a glob that literally includes
   `--app-accent-surface`. `tasks.md:1.1a` and `design.md`'s Context scope it to the
   *intent* tints only. A guard built to the tasks would not satisfy the text of its
   own shipped requirement, and that mismatch is what a final gate refutes on. Fix by:
   (a) narrowing the spec sentence to name the intent tints
   (`--app-success-surface` / `--app-warning-surface` / `--app-error-surface`)
   explicitly rather than a `--app-*-surface` glob;
   (b) adding a short decision (D9) recording *why* accent-derived backdrops are out
   of this change's guard: per C1 the accent is written inline at runtime, so a
   source-parsed guard cannot score them, and the accent-text-on-accent-tint case is
   already covered for 8 presets by `accentTextSourceSyncGuard`;
   (c) recording the residual honestly in the D7 table — that non-accent foregrounds
   on accent tints, and **all** foregrounds on `--app-accent-mid` (5 sites, measured
   3.17-3.63 for the default light accent), are outside this audit and unguarded —
   either as a filed follow-up cited by identifier or as an explicit "untracked",
   under the same D5/5.2a rule the plan already applies to the accent-on-surface
   shortfall. `--app-bg-accent` / `--app-bg-secondary` need no treatment (zero
   background call sites) and `--app-text` on tints passes everywhere (worst 10.57);
   say so, so the boundary is a measured one and the regress stops here.

### Non-blocking notes

- `design.md` D8 step 2 and `tasks.md` 3.4a: the hex `#676057` yields 4.52-4.54
  against the *post-remediation* tints, short of the stated `>= 4.6`. Suggest
  softening to "`#676057` is a floor, not the answer — expect to go to roughly
  `#645d55` once the intent tokens are darkened; the `>= 4.6` target governs."
- `design.md` D8 option 3: drop or reword the "DESIGN.md §3 invariant" claim; §3's
  opacity invariant is about opaque structural surfaces, not wash percentages. The
  app-wide-repaint / owner-sign-off reason carries the decision by itself.
- Round-1 and round-2 CRs are, on my own re-reading, genuinely closed (rendered
  classification with re-runnable enumeration in 2.7, full-matrix guard in 4.2,
  degradation-of-already-failing check in 3.4).
