## Skeptic Report — final gate (round 2B, skeptic-final-2B.md)

Second, independent final-gate reviewer for round 2. Verdict reached on my own
measurements; I read the round-1 reports as claims, not facts. HEAD `037ea0da`,
worktree clean apart from the parallel reviewer's own report file.
(`next-report-number.sh` returned `number=3`; I wrote to the orchestrator-assigned
`skeptic-final-2B.md`, which does not collide with `skeptic-final-2.md`.)

### Ground truth / servers

`start-servers.sh` reported both ports already healthy (REUSED), so I did not trust
the port: `assert-phase.sh servers` → `PASS servers`, and I self-authenticated the
served bundle — `curl http://localhost:6298/src/features/dashboards/ui/DashboardList.css`
returns this branch's cycle-4 content (the `skeptic-final-1B.md CR1` comment blocks,
the `:root[data-theme="dark"] .app-sidebar .dashboard-list__button:hover` override and
the new `[aria-pressed="true"]:hover` rule). `location.href` + `data-theme` were
re-read before every reading below.

### What I verified (with evidence)

**Round-1 CR1 (1B) — sidebar rail, dark: FIXED.** Hovered `.dashboard-list__button`
live in dark: state `rgb(38,35,32)` on `.app-sidebar` `rgb(26,24,22)` = **1.111**
(was 1.030). Rendered: `skeptic2B/dark-sidebar-rowhover.png` shows a clear band; light
`skeptic2B/light-sidebar-rowhover.png` = **1.150**, also clear. The new
`[aria-pressed="true"]:hover` accent-mid step is real and visible
(`skeptic2B/dark-sidebar-selectedhover.png`).

**Round-1 CR (1) — PipelineDetailHeader ActionsMenu trigger: FIXED.** Hovered live,
light: `rgb(255,255,255)` on the header's `rgb(239,236,230)` = **1.179**.

**Guard, re-run by me, twice-plus.** My first two runs failed at `registerAndLogin`
— my own misconfiguration (`playwright.config.ts` defaults `DEV_PORT` to 5173); not a
defect, discarded. With `DEV_PORT=6298`: run 3 went **RED** naming two dark
`sidebar-rail` `.dashboard-list__button` hovers at **1.0893** — which is exactly
`--app-surface-raised` on the sidebar, i.e. the pre-fix value, almost certainly the
parallel reviewer's live mutation-proof mid-flight. Re-run (run 4, tree verified
clean): **GREEN — 458 probed, resolved=458, unresolved=0, pass=186 / fail=22 (all
exempted) / advisory=250**, reproducing the recorded numbers exactly. So: the guard is
real, it is green at HEAD, and I incidentally watched it go red on a live mutation of a
rule it now covers. `check:state-contrast:selftest` → **30 passed, 0 failed**.
The partition assertion (`assertPartitioned`, spec.ts:301-327) is genuine — it stamps
the rendered document, unions the declared views' coverage and throws naming leftovers.

**AC4 / theme.css constraint — MET.** `git diff main...HEAD -- frontend/src/theme/theme.css`
= **0 lines**; no `--app-*` property added anywhere in the frontend diff (grep of all
added lines). The dedicated-token recommendation is recorded in `DESIGN.md` §3 and
explicitly declined pending owner sign-off. `DESIGN.md:561`'s stale "table rows hover
with `--app-surface-soft`" claim is corrected in place to `--app-surface-raised` with
the family-3 rationale. Both round-1 CRs on documentation are closed.

**AC2 reporting honesty — MET.** `files-modified.md:64-72` now states
`pass=186 (41%) / fail=22 all exempted / advisory=250 (55%, gates nothing)` and says
plainly that "458 probed … green" is not "458 states verified", with the route/overlay
bound named. That is honest at the point of the number.

**Cohesion, judged in the running app.** I agree with round-1's reviewer B: the
three backdrop families move in different directions (canvas table rows hover
*lighter*, sidebar/chrome rows hover *darker*), visible simultaneously on `/sources`
in both themes (`skeptic2B/light-sources-rowhover.png`,
`skeptic2B/dark-sources-rowhover.png`). Looking at it as a user, it does not read as
three dialects: the sidebar is a distinct chrome region with its own tone, so a
recessed chip there beside a raised band in the canvas table reads as depth, not
inconsistency. Every state I hovered was legible and low-chroma. Non-blocking; the
`--app-state-hover`/`--app-state-selected` recommendation is the right resolution and
is correctly deferred.

**Resting styles.** Sidebar, `/sources`, `/pipelines`, `/pipelines/:id`, the command
palette and `AddSourceModal` all render with intact hierarchy, spacing and type in both
themes across 33+ changed stylesheets; I found no resting regression. Modal-hosted
states are visibly distinct in both themes (`skeptic2B/light-palette-selected.png`,
`skeptic2B/light-addsource-cancelhover.png`).

### Where it breaks — the ticket's own defect is still shipping, in light theme

On `/pipelines/:id` with a step card **expanded**, in **light** theme, the step-card
action buttons hover with a background byte-identical to the card they sit on:

| reading | value |
| --- | --- |
| `--step-card-hover-bg` resolved on `.pipeline-detail-page__step-card--expanded` | `#ffffff` |
| hovered `.pipeline-detail-page__step-card-duplicate-btn` background | `rgb(255,255,255)` |
| expanded card's own background | `rgb(255,255,255)` |
| ratio | **1.000** (`identical: true`) |

Root cause, single and precise: `PipelineDetailPage.css:298-302 (the `--step-card-hover-bg` line is 301)`
(`.pipeline-detail-page__step-card--expanded { --step-card-hover-bg: var(--app-surface-strong); }`)
is **not** theme-scoped. In light theme `--app-surface-strong` **is** `#ffffff` — the
same value as `--app-surface-raised`, which the same rule sets as the expanded card's
own `background`. This is the exact `raised == strong == #ffffff` collision HEL-866
exists to eliminate, reintroduced by cycle 4's own fix for it. The dark override
(`:root[data-theme="dark"] … --step-card-hover-bg: var(--app-surface-soft)`) is fine —
I measured dark at **1.167**, visible.

Evidence, reproduced three ways so this is not a measurement artifact: (a) hovered
duplicate button, ratio 1.000; (b) after a full page reload, a *different* element
(the drag handle) on a freshly expanded card, `hovered: true`,
`identical: true`; (c) rendered —
`.concertino/runs/HEL-866/evidence/skeptic2B/light-stepcard-expanded-duphover-COLLISION.png`
shows the hovered button with **zero** background feedback, next to
`skeptic2B/dark-stepcard-expanded-duphover.png` where the same state is visible.

I checked whether this class recurs: of every `--app-surface-strong` assignment added
by this diff, **this is the only one not scoped to `:root[data-theme="dark"]`**. So the
finding is one rule, not a pattern — but it is the ticket's canonical defect, on the
rule the round-1 CR named, in the default theme.

The guard cannot see it by construction: `/pipelines/:id` is now visited
(spec.ts:605-612), but only in its **default DOM state** — nothing expands a step card,
and the partition assertion partitions the document *as rendered*, which is honest for
what it claims but says nothing about states reachable only by interaction. Cycle 4's
fix introduced a new conditional branch (`--expanded`) that no gate exercises.

### Verdict: REFUTE

Not a polish nit and not a threshold quibble: in the app's default theme, a hover state
inside a real, reachable UI state renders **exactly nothing**, which is the sentence the
ticket opens with. AC1/AC3 hold everywhere else I looked; AC2/AC4/AC5 are met. One
change request.

### Change Requests

1. **Theme-scope the expanded step card's hover rung — `frontend/src/features/pipelines/ui/PipelineDetailPage.css:298-302 (the `--step-card-hover-bg` line is 301)`.**
   `.pipeline-detail-page__step-card--expanded { --step-card-hover-bg: var(--app-surface-strong); }`
   applies in LIGHT too, where `--app-surface-strong` = `#ffffff` = the expanded card's
   own `--app-surface-raised` background: measured live, hovered, **ratio 1.000,
   `identical: true`**, on both `-duplicate-btn` and `-drag-handle`, reproduced across
   independent page loads (screenshot
   `.concertino/runs/HEL-866/evidence/skeptic2B/light-stepcard-expanded-duphover-COLLISION.png`).
   Give light its own rung measured against `#ffffff` (`--app-surface-soft` is the
   obvious candidate — 1.179 against white elsewhere in this diff), keep the dark
   override as shipped (measured 1.167), and state both measured ratios in the comment.
   Then **re-measure the collapsed card in both themes** to confirm the base assignment
   still holds after the split.
2. **Close the gap that hid it, or name it.** The guard visits `/pipelines/:id` only in
   its default DOM state, so the `--expanded` branch this cycle introduced is
   unmeasured. Either expand one step card before probing that route (a two-line
   interaction in the existing route loop), or record in `design.md` D6.2 that
   interaction-gated component states are outside the guard's population — so the next
   reader knows a green run does not cover them. I would not block on which of the two;
   I would block on it not being silent, since this is the third distinct way a
   hand-shaped population has let a real defect ship green.

### AC status as verified

- **AC1 — NOT MET.** Met on every modal/popover/menu I rendered in both themes; not met
  for the expanded-step-card action buttons in light (ratio 1.000, rendered).
- **AC2 — MET as now qualified.** Reporting is honest at the point of the number; the
  sweep's bound is stated. (CR2 above is about the guard's population, not this claim.)
- **AC3 — MET where measured.** Dark contrast is real, not merely non-identical:
  1.111 sidebar, 1.167 expanded step card, 1.16–1.18 on modal interiors.
- **AC4 — MET.** `theme.css` 0-line diff, no new token, recommendation recorded and
  explicitly declined pending owner sign-off; `DESIGN.md:561` corrected.
- **AC5 — MET.** Guard green at HEAD on my own re-run (458/186/22/250), selftest 30/30,
  partition assertion real, and I observed it going red on a live mutation of a covered
  rule.

### Non-blocking notes

- The dark sidebar-rail hover sits at **1.111** against a 1.10 threshold — correct, but
  with almost no margin; any future darkening of `.app-sidebar` re-breaks it silently.
- Cross-family direction inconsistency (light table rows hover lighter, sidebar rows
  darker) is real but reads as depth, not incoherence, in the running app. I agree with
  round-1B that it is unresolvable without the deferred token adoption.
- `playwright.config.ts` defaults `DEV_PORT` to 5173, so a bare
  `npm run e2e:state-contrast-guard` in a worktree fails obscurely at
  `registerAndLogin` rather than saying "wrong port". Cost me two 6-minute runs.
