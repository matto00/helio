# HEL-1056 — Measurement evidence

All measurements taken live via a Playwright-driven Chromium browser against the
running dev app (frontend `localhost:6488` proxying to backend `localhost:9395`
for HEAD; throwaway worktrees on scratch ports `7001`/`7002` for the isolating
pair), viewport 1280x800, logged in as `matt@helio.dev`. Distance = `getBoundingClientRect()`
gap between the named datum element's bottom and `.ui-data-grid--preview`'s top
border-box (design.md's "Comparison method, datum").

## 1. Why the five prior attempts failed — and why this attempt didn't hit the same wall

**The driver's HEL-904 zero-Outputs hypothesis was wrong.** The dev user
(`matt@helio.dev`) already owns dozens of sources, pipelines, and a succeeded
pipeline run with materialized Outputs (`proj-2026-flat`, 1,000 rows written) —
confirmed by simply opening `/sources` and `/pipelines` in the running app. No
403, no empty state, no fixture seeding was needed for the `SourceDetailPanel`
or `StepCard` call sites. **No fixture data was created or seeded during this
run** (verified via `psql` against the shared dev DB: no `data_sources` row
with today's date; "Create source" was never clicked).

**The real, confirmed blocker was different and narrower — the SQL connection-test
call site specifically, not the other two:**
`SqlTab`'s "Infer schema" button (the actual trigger behind the ticket's
"Test Connection" framing — the visible secondary button, `TestConnectionAffordance`,
tests the *saved-connector* path, not this one) calls `POST /api/sources/infer`,
which the backend's SSRF egress guard (`ContentSourceSupport.isBlockedAddress`)
unconditionally rejects for any loopback/private/link-local resolved address —
**in every environment, with no dev bypass.** The only Postgres reachable from
this dev machine (`localhost:5432`, `ss -tlnp` confirms `127.0.0.1`/`::1` only)
resolves to a blocked address, so a *real* SQL connection test can never
succeed here. Confirmed via direct network evidence:

```
RESP 502 http://localhost:6488/api/sources/infer
{"message":"Egress refused: Host 'localhost' resolves to a disallowed address"}
```

This is almost certainly what stalled at least the SQL-tab leg of the five
prior attempts (their reports weren't available to diff against, but the 502
reproduces on the very first real attempt, unconditionally, with no
account-state dependency).

**Workaround used (frontend-only, never shipped):** intercepted
`POST /api/sources/infer` with Playwright's `page.route` and returned a canned
`{fields: [...]}` body, so `SqlTab`'s real production render path (including
the real `DataGrid variant="preview"` and its frame) executes exactly as it
would after a real successful inference — this measures the same DOM/CSS this
ticket cares about without depending on SSRF-restricted network egress. This
is throwaway test tooling; nothing about it ships in the diff.

The `SourceDetailPanel` and `StepCard` call sites needed no workaround at all
— they were reachable cold, on the very first attempt, once the correct
buttons were used (`.sources-page__create-btn` disambiguated from a duplicate
mobile-CTA match; `Compute column` step needed an explicit click to `expand`
before its `Preview data` button becomes visible — both are ordinary
Playwright selector/UI-state issues, not product defects).

## 2. HEAD (today's shipped geometry, before this ticket's fix) — populated state

| Call site | Datum element | light distance | dark distance | computed `margin-top` |
|---|---|---|---|---|
| SourceDetailPanel | `.source-detail-panel__section-title` (the "Preview" heading) | 18px | 18px | 12px |
| StepCard | `.pipeline-detail-page__step-preview-schema` (output-schema chip block) | 20px | 20px | 12px |
| SqlTab | `.add-source-modal__preview-hint` | 12px | 12px | 12px |

Light/dark are byte-identical for all three — no theme-dependent divergence.

## 3. Isolating pair — `a6bde0d3^` (pre-reframe) vs `a6bde0d3` (post-reframe, HEL-451's own commit)

| Call site | `a6bde0d3^` distance | `a6bde0d3` distance | **Δ attributable to the reframe** |
|---|---|---|---|
| SourceDetailPanel | 12px | 18px | **+6px** |
| StepCard | 12px | 20px | **+8px** |
| SqlTab | 12px | 12px | **unchanged (0px)** |

**The margin-collapse question, answered explicitly: CHANGED, not unchanged** —
by +6px (SourceDetailPanel) and +8px (StepCard). SqlTab is unchanged.

## 4. HEAD vs `a6bde0d3` (attribution: reframe vs. later commits)

HEAD's populated-state numbers (section 2) are **identical** to `a6bde0d3`'s
(section 3) at all three call sites in both themes. The three later
`DataGrid`-touching commits sitting between them
(`dae1117e` HEL-465 column pinning, `3baa1ebf` HEL-458 virtualization,
`9d1734fa` HEL-1065 pin-toggle CSS fix) **introduced no further change** to
this specific geometry — the entire +6px/+8px delta is attributable to the
HEL-451 D10 reframe alone, confirmed by isolation.

## 5. Root cause (probe-confirmed, not inferred)

Direct DOM/computed-style inspection (`getComputedStyle` + `getBoundingClientRect`
on the datum element, `.ui-data-grid__frame`, and `.ui-data-grid--preview`)
confirms the exact mechanism named as a hypothesis in the ticket:

- **SourceDetailPanel:** heading `margin-bottom: 6px`. Pre-reframe, the
  heading's margin-bottom and the grid's `margin-top: 12px` were **adjacent
  siblings in normal flow** and collapsed to `max(6, 12) = 12px` (matches the
  measured 12px). Post-reframe, `.ui-data-grid__frame` sits between them —
  the heading's `margin-bottom: 6px` still collapses with the frame's own
  `margin-top: 0` (`max(6, 0) = 6px`), but the grid's `margin-top: 12px` is
  now a **flex-child margin** inside the frame's `display: flex` formatting
  context, which **never collapses with anything** — so it adds in full on
  top of that 6px: `6 + 12 = 18px` (matches measured exactly).
- **StepCard:** same mechanism, with the schema-chips block's
  `margin-bottom: 8px` in place of the heading's 6px: `max(8, 12) = 12px` pre,
  `8 + 12 = 20px` post (matches measured exactly).
- **SqlTab:** the preview-hint `<p>`'s `margin-bottom` is `0px`, so
  `max(0, 12) = 12px` pre and `0 + 12 = 12px` post — no visible difference,
  which is why this call site alone was unaffected.

This is the ticket's own named risk, confirmed true for two of the three call
sites.

## 6. Fix

`frontend/src/shared/ui/DataGrid.css` — moved `.ui-data-grid--preview`'s
`margin-top: var(--space-3)` off the scroll container (a flex child, inside
`.ui-data-grid__frame`, where it can never collapse with anything) onto a new
`.ui-data-grid__frame--preview` rule (the frame itself — an ordinary block
box and a real sibling of the preceding consumer element, in normal flow).
This restores the exact pre-reframe adjacent-sibling collapse behavior.

**Post-fix measurement (HEAD, live, fresh run):**

| Call site | light distance | dark distance |
|---|---|---|
| SourceDetailPanel | 12px | 12px |
| StepCard | 12px | 12px |
| SqlTab | 12px | 12px |

All three now match the pre-reframe (`a6bde0d3^`) baseline exactly, in both
themes. The `--full` variant is untouched (`.ui-data-grid__frame--full` is a
separate, pre-existing rule; the new `--preview` rule only ever matches
`variant="preview"` frames).

**Guard:** `frontend/src/shared/ui/DataGrid.test.tsx` adds a mutation-failable
static-source CSS assertion (jsdom can't compute resolved/collapsed margins,
so this is the same pattern the file already uses for the sibling D10-3a
guard) that the `margin-top` declaration lives on
`.ui-data-grid__frame--preview`, not on `.ui-data-grid--preview`. Verified red
with the fix reverted, green with it applied (see the "Pre-commit self-check"
transcript in the executor's return for the flip).

## 7. Empty-state preview (zero rows)

At `SqlTab`, an inferred-schema response with zero fields renders **no
`.ui-data-grid` and no `.ui-data-grid__frame` at all** — confirmed by DOM
query counts (`frameCountEmpty: 0`, `gridCountEmpty: 0`) and the actual UI
message shown ("Connection succeeded but no fields were detected."), which is
a different, earlier branch in `SqlTab.tsx` than the one that renders
`DataGrid`. This matches `DataGrid.css`'s own documented behavior ("the
zero-row preview path renders no frame at all") and this ticket's fix does
not touch that path at all — nothing to regress there.

## 8. `SourcePreviewSkeleton` vs. resolved `DataGrid variant="preview"` — DOM diff + ship/no-ship judgement

**Correction (evaluator-1, cycle 2):** the version of this section shipped in
cycle 1 was factually wrong about the loading→resolved transition being
jump-free. It is not, and the skeleton required an actual code change, not a
"ship, no action needed" call. Corrected below with live-measured numbers.

Directly diffed both, mounted in the running app (`SourceDetailPanel`'s
loading vs. resolved preview state), datum = `.source-detail-panel__section-title`
(the "Preview" heading), viewport 1280x800, both themes identical:

| State | before this ticket's fix (= shipped `main`) | after DataGrid.css fix, before SourcePreviewSkeleton fix | after both fixes (final) | `a6bde0d3^` baseline |
|---|---|---|---|---|
| Loading (`SourcePreviewSkeleton`) | 12px | **6px (regression)** | **12px** | 12px |
| Resolved (`DataGrid variant="preview"`) | 18px | 12px | 12px | 12px |

The loading→resolved transition **jumped before this change (12px→18px) and,
for one intermediate state during this change's own cycle 1, jumped again in
the other direction (6px→12px)** — it was never jump-free at any point in this
ticket's history. The jump *magnitude* (6px) happened to be unchanged between
"before" and "cycle-1 intermediate," which is presumably why it wasn't caught
visually, but that is a coincidence of the two margin values involved
(6px heading margin, 12px space-3 token), not evidence the transition was
jump-free — it was materially wrong in both directions before landing here.

**Root cause of the cycle-1 regression:** the DataGrid.css fix moved
`margin-top` off `.ui-data-grid--preview` (a class the skeleton *does* carry)
onto `.ui-data-grid__frame--preview` (a class the skeleton, which renders no
frame at all — D3, it has none of the toolbar/quick-filter chrome a frame
exists to host — did *not* carry). The skeleton's own steady-state spacing
silently dropped to 6px (just the heading's own `margin-bottom`, uncollapsed
with anything), a real, live-measured, unguarded regression against both
`main` and the `a6bde0d3^` baseline this whole ticket is scored against.

**Fix (cycle 2):** `SourcePreviewSkeleton.tsx`'s root `<div>` now also carries
`ui-data-grid__frame--preview` directly (`className="ui-data-grid__frame--preview
ui-data-grid ui-data-grid--preview ui-data-grid--condensed"`) — restoring the
collapsed 12px gap without introducing an actual frame element the skeleton
has no other use for. Re-measured live, fresh, in both themes: **12px loading,
12px resolved, in both light and dark**, matching the `a6bde0d3^` baseline
exactly at every state.

**Guard:** `SourcePreviewSkeleton.test.tsx` (new) asserts the rendered root
carries `ui-data-grid__frame--preview`, verified red with the class removed
and green with it present.

**Ship/no-ship judgement, corrected: shipped, with a code change, not "no
action needed."** The inner element's own class list stays byte-identical to
the resolved render's (`ui-data-grid ui-data-grid--preview ui-data-grid--condensed`),
so there is still no drift in the shared border/radius/background surface
recipe (D3) — but the skeleton's root now *also* needs the frame's margin
class as the margin's actual owner changed, and that is a genuine code
dependency the two markups did not have before this ticket touched
`DataGrid.css`, not a pre-existing wash.

## 9. Themes

All measurements above were taken in both light and dark theme
(`localStorage.setItem('helio-theme', ...)` + reload). No theme-dependent
divergence was found anywhere in this investigation — every distance/margin
number is byte-identical between light and dark at every call site, in every
commit measured (`a6bde0d3^`, `a6bde0d3`, HEAD pre-fix, HEAD post-fix).
