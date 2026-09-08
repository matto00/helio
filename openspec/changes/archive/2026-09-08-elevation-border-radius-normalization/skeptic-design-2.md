## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Base `3a0c0fe8`. Cold spawn. Every number below re-derived by me from the tree with a
multi-line-aware parser (a line grep truncates these declarations — that is how both prior
measurements went wrong). No visual observation was made, so no dev-server provenance is
claimed or required for this report.

### What I verified (with evidence)

**The corrected 22 is RIGHT, and the classification is RIGHT in substance.**
I parsed every `box-shadow` declaration in `frontend/src/**/*.css` with comments stripped and
multi-line values joined, then classified against the two elevation tokens by name:

```
total 47   token-or-none 25   non-token 22
```

The 22 partition exhaustively into exactly the two families D0 names:

- **9 zero-offset, zero-blur spread rings** — `shared/ui/inputs.css` (`0 0 0 3px var(--app-accent-dim)`,
  `0 0 0 3px var(--app-error-surface)`), `features/auth/ui/auth.css`, `features/dashboards/ui/DashboardList.css` ×4,
  `shared/chrome/AccentPicker.css` ×2 (`0 0 0 2px var(--app-surface-strong), 0 0 0 4px var(--app-accent)`).
- **13 `inset … color-mix(in srgb, var(--app-text) 35%, transparent)` scroll-fade edges** —
  `shared/ui/DataGrid.css` ×3, `features/sources/ui/SourceListTable.css` ×3,
  `features/pipelines/ui/PipelineListTable.css` ×3, `features/connectors/ui/ConnectorsPage.css` ×4.

**I attacked the permissive reading and it holds.** Not one of the 22 is an elevation shadow:
there is no declaration outside the two tokens carrying a y-offset with a blur (the shape of a
resting/lift shadow). Every one is either `inset` (a fade painted inside the box — the opposite of
elevation) or `0 0 0 Npx` (a spread ring at zero blur — a border substitute). So "two families, no
elevation token applies" is correct, and D0 is **not** wrong in the permissive direction. This
ticket does not have hidden shadow cleanup.

**CR2 is genuinely discharged.** `DESIGN.md:123-135` is the HEL-774 carve-out with a measured
≥3:1 glyph floor; `BottomNav.css:34-39` carries `box-shadow: var(--app-shadow-soft)`, a comment
citing `DESIGN.md §0.2`, `backdrop-filter: blur(12px)` + `-webkit-` prefix, and a dedicated tint
layer below. D3 and task 3.2 now read verification-only. Confirm.

**`--app-focus-ring` claim confirmed.** `theme.css:299` defines it as `2px solid var(--app-accent)`
consumed at `:focus-visible { outline: … }` — an outline, a different mechanism from these
box-shadow rings. Routing convergence to HEL-1022 is correct.

**CR3's ramp half is discharged.** D6 and task 4.3 now carry the fixed rung→component→token table
with confirm/mismatch/gap semantics. Good.

**Guardrails respected in the artifacts:** `Modal.css` untouched (task 3.3), HEL-1037/HEL-1022
explicitly excluded, accent-border sites frozen (3.4), scroll-fade duplication routed to a spinoff
rather than absorbed.

### Verdict: REFUTE

Three defects. None is a wrong-direction design call — the round-1 corrections landed. But two of
them would let the executor build a guard that cannot fail, and one would put a measurement the
plan itself retracted into the PR body. All three are cheap edits to the artifacts.

### Change Requests

**1. The retracted "0/47 / ZERO literal" claim still survives in three places, including the PR body.**
CR1(a) required correcting it everywhere; `ticket.md` and `proposal.md` were fixed, these were not:
- `design.md:106` — "That is the honest finding: **0/47 shadows** and 12/17 radii are already correct."
- `tasks.md:46` (task 6.2) — "PR body states the measured audit (**0/47 shadows literal**, …)". As
  written the executor is *instructed* to publish the false number in the PR.
- `openspec/changes/elevation-border-radius-normalization/workflow-state.md:45` — "**box-shadow:
  ALREADY DONE.** 47 declarations, **ZERO literals**." The executor reads workflow-state.
Replace all three with the corrected framing: 47 declarations, 22 non-token, all 22 in two families
no elevation token covers.

**2. The strict pinning rule is stated for the radius exceptions and omitted for the shadow ones — the
new families are the ones that can silently make the guard unfailable.**
`D4` and task 2.3 require an exception "pinned to an exact file, declaration and count", but task
2.3's scope is *"whichever sub-scale radii survive task 3.1"*. Task 2.1b, which introduces both
shadow families, says only "pin … as exceptions" and describes them with `~10` / `~12` /
"byte-identical". Both descriptions are wrong against the tree (it is **9 and 13**), and
"byte-identical" is false: the inset family has **four** distinct values (single-left, single-right,
the two-shot combined declaration, and ConnectorsPage's `inset 8px 0 8px -8px` variant). An executor
handed an approximate count and a false uniformity claim will reach for a *pattern* exception —
`/inset .*color-mix/` or, worse, a per-file allowance — and a pattern or per-file exception is a
permanent hole that can never expire. Required:
- (a) Extend 2.1b to carry 2.3's rule verbatim: **exact file + exact declaration text + exact count**,
  never a per-file allowance and never a value-shape regex.
- (b) Fix the counts to 9 rings and 13 insets, drop "byte-identical", and record the four distinct
  inset values (the `8px` variant is a separate pinned entry, not a footnote).
- (c) Task 2.4's stale-exception RED mutation must be exercised on a **shadow** exception (drop the
  count by one, and separately delete one of the pinned declarations from the CSS) — the radius arm
  proving expiry does not prove the shadow arm does.
- (d) Add a fourth mutation to 2.4: insert the literal `box-shadow: 0 2px 8px var(--app-text)` **into
  one of the exception-bearing files** (`DashboardList.css` or `DataGrid.css`) and require RED. This
  is the mutation that catches a per-file allowance, which the current three cannot.

**3. CR3's other half was not done: task 4.2, the absence-hunt, is still unbounded and still vacuously
dischargeable — and it is the finding most likely to matter.**
D6/4.3 got the fixed table; `D5` and task 4.2 were left as "hunt for surfaces with NO elevation …
report findings". Nothing in that can be called wrong by a reviewer, and by the plan's own admission
(D5, HEL-1035) an absence is the one class of finding no grep and no guard can reach. It needs the
same treatment 4.3 received: fix the **inventory** at design time. Enumerate the concrete surfaces to
walk in both themes — dashboard list, panel grid, pipeline detail, sources list, source detail panel,
connectors, settings, onboarding checklist, empty/error states — plus **every overlay class**
(Modal, Popover, UserMenu, MobileNavSheet, toast) — and require a stated per-item result
(elevation present / absent-and-expected / not-applicable). A pass on 4.2 must be that list with an
outcome on every row, not a sentence.

### Non-blocking notes

- CR2 asked for the BottomNav DESIGN.md edit to be dropped from task 5.1; 5.1 still says "and the
  `BottomNav` backdrop-filter outcome". Harmless if the outcome is "unchanged, already documented at
  DESIGN.md:123-135", but re-stating an existing carve-out is duplication that drifts. Prefer:
  record nothing new for BottomNav.
- `ConnectorsPage.css`'s `inset 8px 0 8px -8px` variant is the same recipe at a different size in the
  same file as the 12px copies. That inconsistency is worth naming in the scroll-fade spinoff, not
  fixing here.
- The scroll-fade recipe is duplicated across four files with explanatory comments in three of them
  that reference each other (`DataGrid.css:11`, `PipelineListTable.css:24`, `SourceListTable.css:89`,
  `ConnectorsPage.css:51`). The comments are good; the duplication is the spinoff. Agreed as scoped.
