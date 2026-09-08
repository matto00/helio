# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `f36132fa`, base `origin/main` @ `9e995f69`. Working tree clean.

**Content self-authentication (task 6.4).** `eyebrow` has **0** occurrences in
`frontend/src/features/auth/ui/LoginPage.tsx` on `origin/main`; the dev server at
`http://localhost:5173` serves a transformed `LoginPage.tsx` containing **6**. The vite process on
`:5173` is pid 1703865, rooted at this worktree. Backend `:8080` reports `{"status":"ok"}`.
Every observation below was taken against that server.

---

## Phase 1: Spec Review — FAIL

**Independent re-derivation of the corpus (task 0/1).** I wrote my own scanner (brace-matched CSS
blocks, comments stripped, `frontend/src/**/*.css` minus `theme/theme.css`, block matched when it
declares >= 3 of the five recipe properties *with the recipe's own values*). Two runs:

| variant | files | blocks | all-5 | exactly-3 |
| --- | --- | --- | --- | --- |
| accepting `var(--eyebrow-*)` **and** their expansions (`var(--text-micro)`, `var(--weight-medium)`, `0.14em`) | 27 | 40 | 15 | 8 (17 at 4) |
| strict `var(--eyebrow-size)` / `var(--eyebrow-tracking)` / `var(--eyebrow-weight)` spellings only | **23** | **29** | **12** | **17** |

The strict variant reproduces the design's 23/29/12/17 **exactly**. Recording the precondition, per
evidence rule 6: the corpus figure is stable only under the strict-token reading; under the broader
value-identical reading the population is 40 blocks / 27 files. Nothing in the artifacts states which
reading is meant, and the two differ by 11 blocks.

**Independent classification of the 29 (P1..P6, evaluated in order):**

- **P1 DEAD = 2** — `AuditEventTable.css:14 .audit-event-table__th`,
  `SourcesPage.css:16 .sources-page__section-title`. Confirmed.
- **P2 SIZE-DIVERGENT = 1** — `AgentMemoryList.css .agent-memory-list-table__kind`
  (`font-size: var(--text-xs)`, no `font-weight`). Confirmed. (Minor: the artifacts cite line 82;
  my parse puts the block open at line 75. Same block, cosmetic drift.)
- **P4 VALUE-IDENTICAL = 13** — the 12 all-5 blocks minus the 2 dead (= 10), plus the 3 partials
  that declare an explicit `font-weight: var(--weight-medium)` (`auth.css:91 .auth-field label`,
  `MfaEnrollModal.css:86 .mfa-enroll-modal__field label`,
  `MfaSecuritySection.css:21 .mfa-security-section__badge`). Confirmed = 13, and it matches the
  converted set exactly.
- **P5 WEIGHT-INHERITING = 13** *before* P3 is applied. Confirmed.
- **P6 OTHER = 0.** Confirmed — the partition is total on this tree.

2 + 1 + 13 + 13 = 29. **Exhaustive and disjoint.**

**FINDING P-1 (arithmetic — reporting defect, not an outcome defect).** The executor reported
P1=2, P2=1, **P3=2**, P4=13, **P5=13**, P6=0, which sums to **31 against a 29-block corpus**. P3 is
evaluated *before* P5 (task 0.2), so the 2 blocks classified UNREACHABLE are drawn out of P5 and
P5 must be reported as **11**, not 13. Reporting both as 13 restores exactly the double-counting the
predicate ordering was introduced to make impossible (workflow-state "FIX (round 2)"). The delivered
outcome is unaffected — 16 blocks unconverted either way — but the reported partition is wrong, and
this lane has had five stale-count defects already.

**FINDING P-2 (task 5.1 / 3.4 / 0.3 — the unconverted list exists in no committed artifact).** The
tasks require every unconverted block to be recorded with FILE, SELECTOR and REASON, and the
before/after weights for the P5 population to be recorded. `files-modified.md` — the only committed
handoff — lists **only what changed**. It contains no unconverted list, no per-block weight readings,
no predicate counts, and does not carry task 4's open question about
`.agent-memory-list-table__kind`. The tasks say "in the PR body", and no PR exists yet; but the
orchestrator's brief states this list is HEL-1043's input and "must not need re-deriving", and today
it does. Boxes 0.3, 3.4, 4.1, 4.2 and 5.1 are checked with nothing durable behind them.

**FINDING P-3 (task 6.1 — no BEFORE screenshots).** `.concertino/runs/HEL-732/evidence/` holds six
PNGs, all written at 08:59 (post-conversion): `{badge-mfa-settings,label-login,th-sources}` x
`{light,dark}`. That is an AFTER set only. Task 6.1 requires "Screenshots BEFORE and AFTER, BOTH
themes"; box 6.1 is checked. Task 6.2's three structural contexts are covered as far as they can be
(`th`, badge, label); no `dt` block was converted, so that context is legitimately N/A. Positive:
the PNGs are correctly untracked (task 6.3 respected — `git ls-files .concertino` shows only
`laws/` and the template).

Otherwise in scope: `theme.css`, `.eyebrow`, the `--eyebrow-*` tokens and `DESIGN.md` are
**untouched** (verified against the diff). No scope creep. The AC-unachievability statement required
by 8.2a exists in the change artifacts and correctly names HEL-1043.

---

## Phase 2: Code Review — FAIL

**Gates, re-run by me in `WORKTREE_PATH` (not trusted from the executor's report):**

| gate | result |
| --- | --- |
| `npm run lint` | pass (0) |
| `npm run format:check` | pass (0) |
| `npm run typecheck` | pass (0) |
| `npm --prefix frontend test` | pass (0) |
| `npm run check:tokens` | pass (0) |

Per task 7.1, I state it plainly: **no gate exercised this change.** That is not a formality here —
the regression in FINDING C-1 below is live in the running app and every one of these five gates is
green over it. Root `npm test` was correctly not cited.

**The `tokenAuditSweep.css.test.ts` baseline edit is legitimate — verified independently, not
inherited.** I parsed both revisions programmatically: **62 entries on `origin/main`, 62 on `HEAD`**;
the `(file)` multiset is **identical** (no entry added, removed or retargeted); 35 entries changed
position only. I then resolved **every** `HEAD` pin against the `HEAD` content of its file:
**0 of 62 fail to land on a real `px` declaration**. This is line-number re-pinning forced by
removing five declarations from four files, not a fixture bent to make a check pass.

**Seeded data cleanup — verified, not taken on report.** `agent_memory` in the shared dev DB
(`localhost:5432/helio`) has **0 rows**. No residue.

**No synthetic scaffold (task 3b.3) — verified.** The diff adds no fixture, story, harness, test
page or route. The only test file touched is the baseline above. Every `.tsx` change is a
`className` addition on an existing element. Clean.

### FINDING C-1 (BLOCKING) — a second consumer of a gutted selector lost the recipe entirely

`frontend/src/features/dashboards/ui/DashboardList.css:30 .dashboard-list__header h2` had its five
recipe declarations removed, and `className="eyebrow"` was added to the one `<h2>` in
`DashboardList.tsx:203`. But that CSS rule has **two** consumers:

- `frontend/src/features/dashboards/ui/DashboardList.tsx:203` — converted.
- `frontend/src/shared/chrome/SidebarItemList.tsx:300` — **`<h2>{heading}</h2>`, no class added.**

`SidebarItemList` is rendered by `shared/chrome/SidebarBody.tsx` with three headings
(`:76 "Data Sources"`, `:109 "Data Pipelines"`, `:200 "Assistant"`). Measured live, both routes:

```
/sources   .dashboard-list__header h2  "Data Sources"    class=""  font-size 24px  font-weight 700  text-transform none  letter-spacing normal  mono false
/pipelines .dashboard-list__header h2  "Data Pipelines"  class=""  font-size 24px  font-weight 700
```

On `origin/main` that element matched a (0,1,1) rule declaring all five recipe properties, so it
rendered at 10px / 500 / mono / uppercase / 1.4px tracking. It now renders at **24px / 700 / sans /
no transform / no tracking** — a large, obvious visual regression on three sidebar section headings,
shipped silently.

This directly violates the change's own spec delta (`specs/eyebrow-utility-consolidation/spec.md`):
*"WHEN a component's local recipe is replaced by the shared utility THEN the element's computed
typography is unchanged"*, and the ticket AC *"Every converted block is shown not to change its
computed `font-size` or `font-weight`"*.

It is also foreseeable from the file itself: the comment 11 lines below the edited block, in the
same stylesheet, already says *"`shared/chrome/SidebarItemList.tsx` imports this stylesheet and
reused the same class"*.

**Root cause (stated so the fix is not just a patch):** the whole method is **block-scoped** —
tasks 2.0/2.3 say "measure every block you convert". The unit that actually matters is
**(selector → the set of rendered elements it matches)**. A block-scoped measurement passes as long
as *one* element got the class. The executor did get this right for two other multi-consumer
selectors — `.source-detail-panel__section-title` (`SourceDetailPanel.tsx` + `EmptySchemaAffordance.tsx`)
and `.source-list-table th` (all `HEADER_COLUMNS`) — so this is one miss, not a systemic misreading;
but the method as written does not force it.

I swept the **other 12** converted selectors for the same defect, statically (every `.tsx` consumer)
and at runtime on `/`, `/sources`, `/pipelines`, a pipeline detail page and `/settings`, in **both
themes**:

- `.auth-field label` — 7 `auth-field` containers across `LoginPage`(2) / `RegisterPage`(3) /
  `MfaVerifyPage`(1) / `ConnectorCompletionPage`(1); all 7 `<label>`s carry `eyebrow`. Clean.
- `.mfa-enroll-modal__field label` — 1 container, 1 label, converted. Clean.
- `.source-list-table th` — 5 `th` rendered, all measured 10px/500. Clean.
- `.agent-memory-list-table__th` (4), `.api-tokens-list-table__th` (4), `.connectors-page__th` (7),
  `.pipeline-list-table__th` (7) — every header including the actions column carries `eyebrow`. Clean.
- `.source-detail-panel__section-title` (2), `.schema-field-viewer__title`,
  `.dashboard-appearance-editor__label`, `.mfa-security-section__badge`,
  `.pipeline-detail-page__footer-output-label` (2) — all consumers carry `eyebrow`. Clean.

So the defect is confined to `.dashboard-list__header h2`.

**Design/code standards.** No CONTRIBUTING or DESIGN `[mechanical]` violations found in the diff:
no inline FQNs, no dead code, no new tokens or variants, no off-scale literals introduced,
`check:tokens` green, class ordering consistent (`eyebrow` first, then the BEM class).

---

## Phase 3: UI Review — FAIL

Triggered (`frontend/**`). Measured live in both themes.

### The decisive P5 claim — INDEPENDENTLY CONFIRMED

The executor's single most consequential claim is that all 13 P5 blocks inherit computed
`font-weight: 400` while `.eyebrow` would impose `500`, so converting them is a real visual change.
I re-took this on the real surfaces (not a scaffold), via each block's own selector, on
`/pipelines/ebf9617e-6403-4055-95cb-af4aae75c7e3`:

| selector | text | computed font-size | computed font-weight | parent font-weight |
| --- | --- | --- | --- | --- |
| `.outputs-rail__kind` | "TABLE" | 10px | **400** | 400 |
| `.output-gallery-card__kind` | "Table" | 10px | **400** | 400 |
| `.outputs-gallery-tab__count` | "1 output" | 10px | **400** | 400 |

Three independent P5 instances, all **400**, inherited from the parent — `.eyebrow` would impose
500. **The reading is correct, and leaving P5 unconverted was the right call.** Precondition on the
count: I reached and measured 3 of the 13 P5 blocks; the remaining 10 live on proposal / patch-set /
assistant surfaces I did not reach in this pass. Since none of the 13 was converted, an unmeasured
P5 block carries no regression risk — the exposure is one-directional.

### Converted blocks — measured after, both themes

All 13 converted selectors that I could render measured **10px / 500 / uppercase / 1.4px /
JetBrains Mono**, i.e. the utility wins the cascade at every site (no competing rule now overrides
it, and none did before). Light and dark were byte-identical for every reading — no theme-dependent
divergence. The exception is FINDING C-1 above.

### Other checks

- No console errors attributable to this change on any route visited.
- Interactive elements unchanged (class-only additions; `htmlFor`/`aria-label` untouched).
- No layout breakage: the change alters typography only, and the one place it does so unintentionally
  is C-1.

---

## Overall: FAIL

## Change Requests

1. **`frontend/src/shared/chrome/SidebarItemList.tsx:300`** — add the class:
   `<h2 className="eyebrow">{heading}</h2>`. This is the second consumer of
   `.dashboard-list__header h2`, whose recipe was removed in `DashboardList.css:30`. Without it, the
   sidebar's "Data Sources", "Data Pipelines" and "Assistant" headings render 24px/700/sans instead
   of 10px/500/mono-uppercase. Then **re-measure both consumers** (`/` for `DashboardList`,
   `/sources` and `/pipelines` for `SidebarItemList`) and confirm each computes
   `font-size: 10px`, `font-weight: 500`, `text-transform: uppercase`, `letter-spacing: 1.4px`.

2. **Re-run the multi-consumer check as an explicit step, and record it.** For **each** of the 13
   converted selectors, enumerate *every* element that matched it on `origin/main` — not one
   representative — and confirm each received the class. I ran this sweep and found only C-1, so
   this request is about making the evidence yours and durable: state, per converted selector, how
   many elements matched and that all of them were converted. The method as written measures
   *blocks*; the unit that matters is *(selector -> matched elements)*.

3. **Correct the predicate arithmetic.** Report **P5 = 11**, not 13, given P3 = 2 is drawn from P5
   and is evaluated first (task 0.2). State the totals as 2 + 1 + 2 + 11 + 13 + 0 = **29**, and name
   which two blocks are the P3 members together with the route attempted and where it stopped
   (task 3b.2 requires the attempt to be auditable, not asserted).

4. **Write the unconverted list into a committed artifact**, not only into the return message —
   `files-modified.md` or a sibling file in the change dir. It must contain, for each of the 16
   unconverted blocks: FILE, SELECTOR, REASON, and for the P5 members the measured computed
   `font-weight` (before) against the 500 the utility would impose. It must also carry task 4's open
   question for `.agent-memory-list-table__kind` verbatim. This is HEL-1043's input and it currently
   does not exist anywhere durable.

5. **Either take the BEFORE screenshots or uncheck task 6.1.** The evidence dir holds an AFTER set
   only (all six PNGs written 08:59, post-conversion). If a before/after pair is impractical now
   that the branch is committed, say so explicitly and rely on the numeric measurements — but do not
   leave 6.1 checked as though a before set exists.

6. **State the corpus precondition with the count.** "29 blocks" holds only under the strict
   `var(--eyebrow-*)` spelling; accepting the value-identical expansions
   (`var(--text-micro)` / `var(--weight-medium)` / `0.14em`) yields 40 blocks in 27 files. Name the
   reading alongside the number so the figure stays true.

## Non-blocking Suggestions

- `AgentMemoryList.css`'s `.agent-memory-list-table__kind` is cited at line 82 in the artifacts; the
  block opens at line 75. Same block — worth correcting so the P2 citation is dereferenceable.
- Consider noting in the PR that the five green gates (lint / format / typecheck / jest /
  check:tokens) were all green **over the C-1 regression**. That is the sharpest available evidence
  for this ticket's own claim that no gate exercises a CSS consolidation.
