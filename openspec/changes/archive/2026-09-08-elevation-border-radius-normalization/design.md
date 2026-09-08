## Context

See proposal.md - Why. The measured audit is in `ticket.md`; full evidence in
`.concertino/runs/HEL-442/evidence/premise-validation.md`.

The state of the four properties this ticket names:

| property | declarations | literal | verdict |
| -- | -- | -- | -- |
| `box-shadow` | 47 | **22 non-token** (CORRECTED, r1 CR1) | two coherent families, neither elevation |
| `border-radius` | 283 | 17 | 12 are `50%` (correct); 5 are sub-scale |
| accent borders | 46 | n/a | documented idiom, not drift |
| `backdrop-filter` | 2 | n/a | one in scope, one is HEL-1035's |

## Goals / Non-Goals

**Goals:**

- Hold the already-good state with a guard that nothing currently provides.
- Decide the five sub-scale radii deliberately, on the running app, one at a time.
- Leave the rules behind in `DESIGN.md` so the next reviewer does not re-litigate `50%`.

**Non-Goals:**

- See proposal.md. Above all: **do not manufacture cleanup.** The measured finding is that this area is largely
  healthy; a diff sized to match the ticket's description would mean changing correct code.

## Decisions

**D0 (NEW, design gate r1 CR1) - The `box-shadow` measurement was WRONG, and the corrected picture changes the guard.**
My audit reported "47 declarations, ZERO literal" by filtering on `var(--`. That scored declarations clean whose
COLOUR is tokenised while their GEOMETRY is fully literal. Re-measured against the two elevation tokens specifically:
**22 declarations use neither `--app-shadow-card` nor `--app-shadow-soft`**, in two coherent families:
Exact split (47 total = 25 token/`none` + 22 non-token), re-verified multi-line-aware; **the earlier `~10`/`~12` were
approximations and are corrected**:
- **9 zero-blur spread rings** — `0 0 0 3px var(--app-accent-dim)` x6, AccentPicker's double ring
  `0 0 0 2px var(--app-surface-strong), 0 0 0 4px var(--app-accent)` x2, `0 0 0 3px var(--app-error-surface)` x1.
  Note `--app-focus-ring` (theme.css:299) is an **outline** token (`2px solid var(--app-accent)`) used via
  `outline:`; these are the box-shadow mechanism, which renders differently. Converging them is HEL-1022's remit.
- **13 scroll-fade insets**, in **FOUR distinct values — NOT byte-identical**, which an earlier draft wrongly claimed:
  `inset 12px 0 12px -12px color-mix(...)` x4, `inset -12px 0 12px -12px ...` x4, the two-shadow combined form x4, and
  `inset 8px 0 8px -8px ...` x1 (ConnectorsPage). The distinction matters: "byte-identical" invites a single
  pattern-match or per-file allowance, and **a pattern exception can never expire**.

**Not one of the 22 carries a y-offset with a blur** — the shape of an elevation shadow — which is the positive
evidence that no elevation token applies to any of them, rather than an assertion that none does.

**Neither elevation token applies to either family**, so AC1's "where a token applies" is still honestly satisfied —
but the guard MUST carry explicit exception slots for both, or the executor is pushed into one of two failures: snap
them onto `--app-shadow-card` (the HEL-441 locally-tidier-globally-worse trap, on a focus ring), or loosen the guard
to "contains any `var()`" — **under which task 2.4's own required RED mutation would pass green.** That loosening is
explicitly forbidden. The scroll-fade duplication is REPORTED as a spinoff candidate, not absorbed.

**D1 - `50%` is an ALLOWED radius value, not an exception to be tolerated.** Twelve declarations use it — avatars,
`Spinner`, the `Toggle` knob, `AccentPicker` swatches, `StatusChip`, `MobileNavSheet`. On a square element `50%` and
`--app-radius-pill: 9999px` render identically, but `50%` is the semantically correct expression of a circle and
survives a size change that a fixed radius does not. Snapping any of them to `sm`/`md`/`lg` would visibly break the
shape. The guard therefore treats `50%` as valid alongside the four tokens — **not** as a pinned exception, because an
exception invites a future ticket to "resolve" it. Recorded in DESIGN.md for the same reason.

**D2 - The five sub-scale radii are a judgment call, and the default answer is LEAVE THEM.** `1px` (DividerPanel,
PipelineDetailPage), `3px` (MarkdownPanel), `4px` (MarkdownPanel, PipelineDetailPage) all sit below the scale's 6px
floor. "Replace with the nearest scale token" means a **visible 2-5px increase** on decorative details — a 1px radius
is a hairline softening, and 6px on the same element is a different design. **This is precisely the trap HEL-441 hit**:
folding 180ms to the 160ms token was locally tidier and measurably worse. Each of the five is decided on the running
app in both themes; a change is made only where the token genuinely looks right, and where it does not, the literal
stays with a comment stating why. **Measure the spread before and after — do not assume tidier is better.**

**D3 - `Modal.css:60`'s `backdrop-filter` is NOT touched here.** It sits on `.ui-modal::backdrop`, the exact surface
**HEL-1035** owns (filed by this lane hours ago, for that backdrop having no entrance motion). Editing it here would
front-run a ticket this lane created and would put two changes on one surface across two branches.
**`BottomNav.css:38-39` is NOT reopened either (design gate r1 CR2).** My earlier framing — "judge it on the running
app, and if it stays say so in DESIGN.md" — was wrong: it invites an eyeball to overturn a measurement, and the
decision is already documented. `DESIGN.md:123-135` is an explicit **HEL-774 carve-out** naming BottomNav as "the one
exception to 'surfaces are opaque' in the whole app", prescribing `blur(10-16px)` over a tint layer, and replacing the
invariant with a **measured contrast floor, not an eyeballed judgment call**. `BottomNav.css:35-37` cites it by
comment. This ticket's job is therefore VERIFICATION ONLY: confirm the implementation still matches the carve-out
(blur within 10-16px, tint present, icon-only). It is not a decision to re-make.

**D4 - The guard must be failable, and its exceptions must be able to EXPIRE.** HEL-441's guard was broken five ways
at final gate, including a simulation of HEL-1032's future edit proving its exception expires rather than becoming a
permanent hole. Match that bar: a new literal shadow -> RED; a new off-scale radius -> RED; a stale exception matching
nothing in the tree -> RED; **and a literal shadow inserted INTO an exception-bearing file -> RED** (design gate r2).
That fourth arm is required because the first three cannot catch a per-file or pattern-shaped allowance: if the
exception is "this file may have insets" rather than "these 13 exact declarations", a new literal in that file passes
silently. **Every exception — shadow families included, not only the radius ones — is pinned to an exact file,
declaration text and count**, and annotated with the ticket that would remove it. An unfailable guard is worse than no guard, because it reads as protection.

**D5 - What no source text carries, in this property family.** HEL-441's three spinoffs were all invisible to a source
grep: vendor CSS (HEL-1032), a JS library default (HEL-1034), and an **absence** (HEL-1035). The vendor half of that
check is **done and negative** — `react-grid-layout` and `react-resizable` impose no radius, shadow or border. The
absence half is NOT done and cannot be done by grep: **look on the running app for surfaces with NO elevation where
the ramp says there should be one** — a card sitting flat on the canvas, a popover without `--app-surface-strong`, a
recessed input that is not `--app-surface-soft`. That is the finding most likely to matter here, and the guard cannot
see it.

**D6 (EXPANDED, design gate r1 CR3) - Verify the elevation ramp by computed style against a FIXED table.** A surface
can land on the wrong rung through cascade with no declaration wrong, so this must be read from the browser
(`getComputedStyle().backgroundColor`) in both themes — but "spot-check the ramp" can be discharged with two
screenshots and prove nothing. The rungs, the component to inspect at each, and the expected token are fixed HERE at
design time so the check is falsifiable:

| rung | inspect | expected |
| -- | -- | -- |
| canvas | dashboard grid background | `--app-bg` |
| recessed well / input | a `.ui-input` at rest; `DataGrid` header | `--app-surface-soft` |
| card / chrome | a panel card; sidebar; top bar | `--app-surface` |
| hover | the same card under `:hover` | `--app-surface-raised` |
| overlay | Modal panel; Popover; Toast | `--app-surface-strong` |

Each row is confirmed or reported as a mismatch. A rung that cannot be reached is reported as a gap, not skipped.

## Risks / Trade-offs

- [The diff is small enough to look like nothing was done] -> That is the honest finding: 25/47 shadows use a token and
  the other 22 are two families no elevation token covers, and 12/17 radii are already correct. The deliverable is the guard. Padding it would mean changing correct code.
- [Snapping the sub-scale radii looks tidy and is worse] -> D2 defaults to leaving them and requires a running-app
  judgment per site.
- [A reviewer "fixes" the 46 accent borders later] -> Named as a non-goal in proposal.md and recorded in DESIGN.md,
  because the ticket text alone would lead them there.
- [The guard passes by construction] -> D4 requires three failing mutations and expirable exceptions.

## Planner Notes

Self-approved: `skip_specs: true` (no spec-level behaviour change); D1's treatment of `50%` as valid rather than
exempted; D2's default-to-leave for sub-scale radii. All three are grounded in the measured table above.
