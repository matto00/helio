## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Content self-authentication (before any other observation).** `GET /@fs<this-lane>/frontend/src/main.tsx`
on 5951 -> `200`; the identical request against the MAIN checkout path (`/home/matt/Development/helio/
frontend/src/main.tsx`) -> `403 Restricted`. Port 5951's Vite fs root is THIS worktree. Failable by mutation
(the foreign-path arm IS the mutation, and it is red). It cannot prove a browser tab is fresh — no claim
below rests on one. There is still no app code on this branch (`git status --porcelain` shows only the
untracked change dir; base `3a0c0fe8` HEL-441 confirmed by `git log`), so there is nothing visual to judge at
a design gate and I made no visual observation.

**1. Round-3 CR1 — all three artifacts now consistently specify PREPEND. Closed.** I read the full text of
`proposal.md` and both spec deltas, and re-read D5 and task 5.1.
- `specs/command-action-registry/spec.md`: requirement is now "A contributor may **add** entries to the
  empty-query default" — contributed entries "in addition to ... ordered ahead of it, and SHALL NOT displace
  or suppress it", with the new third scenario "Contributed entries never suppress existing sections". The
  first scenario's THEN now asserts "every section the palette already presented on an empty query is still
  presented after them". An executor building strictly to this spec cannot ship replace, and an archiver
  checking against it cannot bless replace. This is the artifact that mattered most and it is right.
- `specs/palette-recent-navigation/spec.md`: the "instead" wording is gone; the requirement says recents are
  "ordered ahead of — and in addition to —" existing empty-query content and "SHALL NOT remove or suppress
  any section". Both scenarios reworded consistently ("... and every one of those sections is still
  present"; empty history -> "existing default content exactly as it does today").
- `proposal.md`: "displacing"/"falling back" are gone; What-Changes reads "**prepended to** the empty-query
  view (HEL-516's Create/Navigation/General still render)" and Modified Capabilities reads "**prepended to —
  never displacing —** the existing content".

**Residual-replace-semantics sweep — zero live hits.** `grep -rniE
"instead|displac|replac|fall(ing)? back|suppress|in place of|swap"` across design.md, tasks.md, proposal.md
and `specs/`: every hit is either an explicit negation ("never displacing", "SHALL NOT displace or
suppress", "PREPENDS, NEVER REPLACES", D5's "Replace was never intended and is explicitly rejected"), a
scenario title asserting non-suppression, or unrelated prose (`design.md:56` HEL-503 planning;
`tasks.md:100` the `--weight-regular` anecdote; `tasks.md:121` the matrix's N/A substitutions). No
statement anywhere now reads as replace. This grep PROVES no residual replace *wording* survives; it CANNOT
prove the executor reads the design rather than only the tasks — which is why the spec delta being correct
is the load-bearing fact, and it is.

**2. Nothing newly broken by these edits.** `openspec validate palette-recent-navigation --strict` -> "Change
'palette-recent-navigation' is valid" (structural only; it says nothing about semantics). The
`command-action-registry` delta adds a requirement to an existing capability under `## ADDED Requirements`,
which is the correct delta form — I confirmed `openspec/specs/command-action-registry/spec.md` exists and
that none of its eight existing requirement titles collide with the new one. I checked the nearest existing
requirement for contradiction — "A registrant can opt out of local query filtering" (its rationale text even
names "recents ranked by usage") — and it is permissive ("SHALL be able to"), so D5's decision NOT to use
`matchesQuery` (recents synthesized inside the empty-query branch, not registered) does not violate it; its
"ordered after locally-matched actions **within the same section**" clause is section-scoped and does not
conflict with Recent leading `SECTION_DISPLAY_ORDER`. The D5/task-5.1 rewrites leave D1-D4, D6, the 6.2
matrix, and the gate tasks intact; task 5.2's position guard remains load-bearing (not unfailable) precisely
because the other three sections still render, and 5.3's deletion remains correct.

**Not re-opened, per instruction:** rounds 1-2 CRs (verified closed in rounds 2/3), the restated scope and
the `type`/`panel` rulings, the no-unifying-abstraction ruling, and the `hrefFor` decision.

### Verdict: CONFIRM

The plan is substantively correct and internally consistent. The one open thread from round 3 is genuinely
closed in the artifact that survives archive. Nothing in this round's edits introduced a new defect. No
cohesion call is available or needed at this gate (no code exists yet); task 6.4 correctly holds the
owner-mandated visual judgement for the final gate, in both themes, at rest/hover/focus.

### Non-blocking notes  (carried, none blocking implementation)

- Task 5.1 still leaves the mechanical seam to the executor (recents passed into `rankActions` vs.
  substituted at the `CommandPalette.tsx:98` call site); `rankActions(actions, query)` has no access to visit
  history. Workable either way; naming it would save a coin-flip. Carried from rounds 2-3.
- design.md D1 still cites `dashboardsSlice.ts:201` for `setSelectedDashboardId`; the reducer lives under
  `features/dashboards/state/`. Cosmetic, flagged since round 1.
- D2 still does not state in one sentence that a delete-triggered reselect records a visit the user did not
  deliberately choose. Defensible either way; better recorded as a decision than left a side effect.
- HEL-1038's body still describes HEL-519 as "records visits at three explicit per-kind call sites" while
  this design is two mechanisms for three kinds. Correct it when task 7.5's sibling note is written.
- Optional: the `command-action-registry` delta could cross-reference the pre-existing opt-out requirement to
  note that a contributor may add empty-query entries WITHOUT using the `matchesQuery` opt-out (D5's route).
  Purely a readability aid for a future contributor; nothing today depends on it.
