# Evaluation Report — Cycle 3 (evaluation-4.md)

HEAD evaluated: `2ceb63c8`. Server content-authenticated before measuring: the served
`DataGrid.tsx` reports `FRAME_FILTER_COLLAPSE_THRESHOLD_PX = 237` and
`GRID_MIN_USABLE_HEIGHT_PX = 69`, so the browser is running this commit.

### Phase 1: Spec Review — PASS

D10-12's two remedies are implemented as ruled and deliberately kept separate, with the actor
distinction (app's automatic choice vs. user's explicit override) documented at both halves.
`:540`'s stale "~36px" is reconciled to 44px. The accepted consequence — filters collapsed by
default at the dashboard panel's first two size steps — is recorded as ruled, and I am **not**
reporting it as a regression.

### Phase 2: Code Review — PASS

Gates re-run by me: lint clean, typecheck clean, format:check clean, `npm --prefix frontend test`
**293 suites / 3045 tests passed**. Root `npm test` not used as evidence.

Both new guards are mutation-failable (verified by me, worktree restored clean after each):

| mutation | result |
| --- | --- |
| `.ui-data-grid--full { min-height: 69px }` → `0` | RED (static-source floor guard, `:946`) |
| `FRAME_FILTER_COLLAPSE_THRESHOLD_PX` 237 → 151 | RED (derivation guard, `:935`) |

### Phase 3: UI Review — PASS

**The cycle-2 blocker is fixed on its exact repro.** Detail modal at 1100×325, persisted no-match
filter, no user override — frame 167px, now **below** the 237 threshold, so the app collapses
instead of expanding:

| | cycle 2 | cycle 3 |
| --- | --- | --- |
| app's choice at frame 167 | expanded | **collapsed** |
| `.ui-data-grid` | **7px** | **86px** |
| column header row | invisible sliver | fully rendered |

Screenshot `eval4-modal-1100x325-fixed.png`.

**The 149→160 band I mapped is healthy**, and so is the whole app-chosen range. Sweep after a
reload (app decides, no user toggle):

| frame | app expands? | compact | grid | header | per-column input fully visible | frame overflow |
| --- | --- | --- | --- | --- | --- | --- |
| 143 | no | yes | 69 | yes | n/a (collapsed) | no* |
| 200 | no | yes | 119 | yes | n/a | no |
| 236 | no | yes | 155 | yes | n/a | no |
| **237** | **yes** | no | 77 | yes | **yes** | no |
| 238 | yes | no | 78 | yes | yes | no |
| 300 | yes | no | 140 | yes | yes | no |

The transition is exactly at 237 and the app never chooses a state its chrome cannot hold. (*At 143
the frame's `scrollHeight` exceeds its `clientHeight` by 7px, but the frame is `overflow: visible`
and the spill lands in slack above `.panel-content`'s fold — measured: every element fully visible,
`panel-content` `scrollHeight` 159 = `clientHeight` 159, no scroll. Not a defect.)

**The user-override path — what the CSS floor exists for — holds.** Override sweep at frame
149/155/160/200: grid pinned at exactly **69px** at every height, header row present, all 61
per-column inputs present. The cycle-2 crush (7px) and cycle-1 crush (0px) are both unreachable now.

**237 re-derived from live measurement rather than accepting the arithmetic** (this is the term
check you asked for, and one term is wrong — see note 1):

| term | design's value | measured live | ✓ |
| --- | --- | --- | --- |
| toolbar | 37 | 37 | ✓ |
| quick-filter row | 37 | 37 | ✓ |
| full unclamped message | 86 | 86 | ✓ |
| header row | 34.5 | 34.5 | ✓ |
| per-column filter row | ~34.5 (assumed) | **45** | ✗ |

**Enforced minimum still healthy in both themes.** Dark, item 262 / frame 143: collapsed, compact,
grid 69px, header present, toolbar + message + grid all fully visible, no panel scroll, tokens
correct (`rgb(22,21,20)` surface, muted text).

**Sticky re-confirmed fresh after the collapse machinery and floor** — header `th` 211 → 211,
per-column `th` 245.5 → 245.5, body → −109.5 at `scrollTop` 400.

Console: 0 errors.

**CR3 — still UNMET, not softened.** A fourth attempt (SQL source detail, clicking its "Preview"
control) again produced no `.ui-data-grid`. `StepCard.tsx:382`, `SourceDetailPanel.tsx:288` and
`SqlTab.tsx:223` remain unverified; the `--preview` `margin-top` collapse question is open. Filing
it as a follow-up is the right call.

### Overall: PASS

The one residual finding (note 1) is real but cosmetic and does not block.

---

### Notes

**1. `GRID_MIN_USABLE_HEIGHT_PX = 69` inherits an unmeasured term; the honest value is 79.5.
Non-blocking — impact is a 2px clip.**

The derivation treats the per-column filter row as sharing the header row's recipe, "~34.5px". It
does not: it contains `<input>` elements, and it measures **45px** live. So "one header row plus one
per-column filter input" is `34.5 + 45 = 79.5px`, not 69px.

Consequence, measured on the user-override path at the floor (dashboard panel and detail modal
both): grid 69px, header row 297→331.5, per-column row 331.5→376.5, and the input's bottom edge sits
**2px** past the grid's bottom.

I checked whether that 2px matters functionally rather than assuming: the input **focuses**, **accepts
typed input** (set to "abc", value took), is **hit-testable at its centre**, is **93% visible**, and the
grid has 51px of internal scroll that brings it fully into view. So the named invariant is
substantively met — the shell survives and every per-column input is usable. This is a 2px cosmetic
clip at the extreme floor, categorically different from the 0px and 7px crushes of the previous two
cycles.

It is worth correcting anyway, because it is the third threshold term in this ticket derived by
assumption rather than measurement, and that pattern is the ticket's own recurring failure. Changing
`GRID_MIN_USABLE_HEIGHT_PX` 69 → 79.5 (and the CSS literal with it, which the `:946` guard already
ties together) also shifts the honest threshold to `37 + 37 + 86 + 79.5 + 8 = 247.5`. Note the
app-chosen path does **not** need that change: at 237 the grid gets 77px and the input is already
fully visible with 6px to spare — only the override floor is affected.

**2. The behavioural guard at `:962` is weaker than the invariant it names.** It asserts the header
row and per-column inputs "remain in the DOM" when a user overrides collapse. They were in the DOM
in the defect state too — I measured 61 per-column inputs present inside the 7px crushed grid in
cycle 2. So that guard would not have caught either crush. What actually protects the invariant is
the static-source floor guard at `:946`, which is genuinely mutation-failable and which I verified.
Worth reflecting in `guard-vacuity-finding.md`: the fix here was to guard the *mechanism* (the CSS
literal) because the *behaviour* (geometry) is unassertable in jsdom — that is the honest resolution,
but the DOM-presence test should not be described as guarding shell survival.

**3. Dev-DB cleanup — closed.** The `zzzznomatchzzzz` filter was already gone before this cycle; my
cycle-2 "Clear all" click in the modal had persisted `null`. Confirmed by direct query, not
inference: `select ... from outputs where config::text like '%zzzznomatch%'` → 0 rows. (For the
executor's search: the panel is "Projections 2026 table" but the **Output** is named "Projections
2026" — the null they found was the correct row, already clean.)

I did set a fresh `zzzevalcycle3zzz` filter this cycle to reproduce the filtered-empty state, and
cleared it before finishing — verified `config::text like '%zzz%'` → **0 rows**. Two unrelated
Outputs carry pre-existing `columnFilters` from other lanes (`{"quick":"c1"}` on
`hel904-output-c702aa41…`, `{"quick":"wr"}` on `hel904-orphan-output-ae5b18b6…`); not mine, left
alone.

The `SKF2-82col` panel remains at the enforced minimum from my repro resizes, per your ruling that
this reads as nothing.
