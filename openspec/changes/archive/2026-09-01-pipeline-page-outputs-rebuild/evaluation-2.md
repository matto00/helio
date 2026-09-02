# Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed at HEAD `ddbb90e9`, branch `feature/pipeline-page-outputs-rebuild/HEL-908`, tree clean.
All gates re-run fresh by the evaluator at this commit (not trusted from the executor's report).

## Gate re-run (my own, this commit)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (exit 0, `--max-warnings=0`) |
| `npm run format:check` | PASS |
| `npm run typecheck` (`tsc --noEmit`) | PASS |
| `npm test` | PASS — 282 suites, **3009** tests (was 3002; +7 new) |
| `npm --prefix frontend run build` | PASS |
| `cd backend && sbt test` | PASS — **3538** tests, 0 failed (was 3536; +2 new) |
| `DEV_PORT=6340 npx playwright test e2e/hel908-*.spec.ts` | PASS — 5/5 (prints `25 clicks`) |

Dev-server currency verified before any UI evidence: backend `java` pid 1755141 started
`15:15:24`, cwd in this worktree; latest backend-`main`-touching commit is `03ceb034` at
`15:00:16` — the listening process is newer, so it carries the CR1 repository fix.
`/health` → `{"status":"ok"}`; frontend `:6340` → 200 (Vite, serves from disk).

---

## Change-request verification (the Cycle-1 work order)

| CR | Verdict | Evidence |
| --- | --- | --- |
| CR1 tail-on-leaf | **RESOLVED** | live leaf-anchor probe, below |
| CR2 reorder spec/schema | **RESOLVED** | spec + schema + delta, `openspec validate --strict` |
| CR3 dead `GET /api/types` | **RESOLVED** | 4 → 2 404s; attribution independently confirmed |
| CR4 ≥44px touch target | **RESOLVED** | fresh `elementFromPoint` bisection, both chip variants |
| CR5 unstable selectors | **RESOLVED** | zero warnings across a full live interaction session |
| CR6 ARIA tabs | **RESOLVED** | live keyboard probe |
| CR7 inline styles | **RESOLVED** | all 3 moved to CSS classes |
| CR8 file-size audit | **RESOLVED** (with a follow-up gap, non-blocking) | numbers now match `wc -l` |

### CR1 — RESOLVED, and verified on a genuine LEAF anchor

Probed live through the real UI on a newly created pipeline (`381a9d0f`), not via the
e2e fixture. Created one `filter` step (the pipeline's only step → a true leaf), then
clicked `Add tail step` → `Group & aggregate`:

```
filter    79ac7e4c  position 0  parent null
aggregate 0606ccb1  position 1  parent 79ac7e4c   <-- position 1 = real TAIL
```

DOM: `pipeline-detail-page__step-card pipeline-detail-page__step-card--tail`, rendered
inside a `pipeline-detail-page__tail-chain` under the filter card — exactly one trunk
card, exactly one tail card. In Cycle 1 this same probe produced `position 0` and a
second full trunk card. Fixed at the primitive (`attachTailInternalAction` floors the
position at 1 unconditionally), which is the right layer — every caller benefits without
branching on leaf-vs-non-leaf.

The frontend half was also genuinely needed and is correct: `buildStepTree`'s single-child
branch now consults `position`, since a childless anchor gaining one child is the same
flat-array shape either way. The `position === undefined` (unpersisted temp step) default
back to trunk-continuation is reasoned and documented.

Coverage CR1 asked for is all present:
- repository: `PipelineStepRepositorySpliceSpec.scala:417` — "attach onto a childless (leaf)
  anchor still lands at position 1, a real tail, NOT the trunk continuation"
- route: `PipelineStepRoutesSpec.scala:420` — "POST with `attachAsTail: true` on a LEAF
  anchor (no existing children) still attaches at position >= 1, not the trunk"
- e2e: `hel908-full-flow.spec.ts:113-126` asserts trunk-card count 1 + tail-card count 1.

The incorrect rationalization comment **was removed** — `hel908-full-flow.spec.ts:116` now
reads "the filter node here is a leaf (no existing children), which used to fall back to
position 0 (trunk) 100% of the time", which is accurate.

Two-child-anchor regression spot-check: `e2e/hel908-tail-attach.spec.ts` (the original
two-child case) passes, as do all 5 HEL-908 specs.

### CR2 — RESOLVED

`openspec/specs/pipeline-step-reorder/spec.md` now states the trunk-only contract
(permutation of current **trunk** ids; relink `parentStepId`; every trunk position written
as `0`), and the "positions 0, 1, 2" assertion is gone. Two new scenarios added
("A trunk step's own tail follows it when the trunk is reordered", "A tail id in stepIds
is rejected"). `schemas/pipelines/reorder-pipeline-steps-request.schema.json`'s
`description` matches. A `MODIFIED Requirements` delta exists at
`openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-step-reorder/spec.md`, so
archive will carry the correction. `openspec validate --changes --strict` → 1 passed;
`--specs --strict` → 343 passed.

### CR3 — RESOLVED; the executor's attribution claim is accurate

Fresh page load network log: exactly **2** `GET /api/types` 404s (was 4). The three dead
constructs are gone from `usePipelineDetailPage.ts` (the `fetchDataTypes()` mount effect,
the unused `dataTypes` destructure, and the unreachable `markDataTypeRowsStale` dispatch).

I did **not** take the "remaining 2 are SidebarBody's" claim on trust. Verified two ways:
`grep` shows `frontend/src/shared/chrome/SidebarBody.tsx:98` dispatches `fetchDataTypes()`
under `if (section === "pipelines" && dataTypes.status === "idle")` — i.e. it fires for the
pipeline-detail route's own sidebar section (an F-144 delete-confirm-warning consumer), and
it is the only other `fetchDataTypes` caller reachable on this route. The claim holds, and
leaving it is consistent with the ticket's "take `PipelineDetailPage`'s share here, leave
the rest, say which taken" — which task 10.6 now records explicitly.

### CR4 — RESOLVED; the executor's revised diagnosis is correct and mine was wrong

I re-ran the `elementFromPoint` bisection myself (0.25px step, 375×812), on both chip
variants, on a pipeline carrying a real saved Output:

| chip | box | real vertical extent | real horizontal extent | up / down |
| --- | --- | --- | --- | --- |
| `CHART / Untitled output / 3 rows` | 228.14 × 28 | **44.75px** | 120.25px | 22.75 / 21.75 |
| `+ Output` (add) ×3 | 87.72 × 28 | **44.75px** | 88.75px | 22.75 / 21.75 |

Against Cycle 1's measured 36.75px vertical / ~0.5px-per-side horizontal. Both dimensions
now clear the 44px floor, and the expander is symmetric about the control (22.75 / 21.75),
so it is genuinely centered.

Independently assessing the two competing root causes: **the executor is right and my
Cycle-1 diagnosis was wrong on this point.** The media-query rule in `tapTarget.css` already
computed `top: 50%; height: 44px; transform: translateY(-50%)` — properly centered — so
"the `::after` is shifted downward" was a misreading. The actual cause was
`.pipeline-detail-page__step-card`'s `overflow: hidden` clipping the bottom overhang, which
`z-index` provably cannot escape; the fix (`padding-bottom: var(--space-2)` on the card,
scoped to the same touch-target media query) is the correct remedy for a clipping ancestor.
The rail `gap` raise 8px → `--space-4` (16px) is separately correct per DESIGN.md. The
added `z-index: 1` on the shared `.tap-expand-44::after` is defensible belt-and-braces.
Task 3.6's note now cites the bisection rather than the `getComputedStyle` evidence
DESIGN.md names as insufficient.

### CR5 — RESOLVED, verified behaviorally not just by code inspection

Ran a real session against the running app: page load → tab switch → ArrowRight/ArrowLeft
keyboard nav → open "Add output" sheet → Save an Output → two viewport resizes → scrolling
and chip bisection. Console for that whole session contains **zero** occurrences of either
`"Selector unknown returned a different result"` or `"An input selector returned a different
result"` (`grep -c` → 0). In Cycle 1 these grew 2 → 4 → 6 → 8 across a comparable session.

The fix is the right one: a module-level `EMPTY_OUTPUTS` sentinel shared by both call sites,
plus `selectOutputsForStep` converted from a fresh-`.filter()`-per-call plain selector into a
`createSelector`. The false doc-comment claim about memoization was corrected honestly.
New Jest reference-stability coverage added (`outputsSlice.test.ts`).

**F-146 is now genuinely fixed**, not partially.

The only console output in the session was 3 pre-existing errors (2× `/api/types` 404 per
CR3, 1× `/schedule` 404 = the handled "no schedule set" case) and 2 pre-existing ECharts
`"Can't get DOM width or height"` warnings when the preview pane mounts before layout.

### CR6 — RESOLVED, verified by live keyboard interaction

Not just inspected — driven with real key presses. Focused the Steps tab, pressed
`ArrowRight`:

```
before: active="Steps"        tabIndex=[0,-1]  aria-selected=[true,false]  panels=[...tabpanel-steps]
after:  active="Outputs (0)"  tabIndex=[-1,0]  aria-selected=[false,true]  panels=[...tabpanel-outputs]
```

`ArrowLeft` returns. Both tabs carry `id` + `aria-controls`; each panel carries
`role="tabpanel"` + `aria-labelledby` (the a11y tree now reports `tabpanel "Steps"` with a
real accessible name). Roving `tabindex` works. Keeping the pattern local rather than
extracting a `shared/ui/` primitive is justified in-comment and I agree — one consumer.

### CR7 — RESOLVED

All three static inline styles in `OutputPreviewPane.tsx` replaced with
`.output-preview-pane__chart` / `__markdown` / `__table-section` in `OutputEditorSheet.css`.
No inline `style={{}}` remains in that file.

### CR8 — RESOLVED (numbers and provenance), with one residual follow-up gap

`wc -l` at this commit matches tasks.md exactly: `usePipelineDetailPage.ts` **955**,
`OutputEditorSheet.tsx` **569**. The false provenance claim is retracted in plain terms —
tasks.md now states both files are wholly NEW files this ticket created (not pre-existing
outliers), that `git show main:...` returns nothing for each, and that they were over budget
from creation. The deferral reasoning (cross-cutting F-146/F-105/HEL-878 ref-stability
invariants dependent on hook call order) is specific and credible, not hand-waving.

Residual: CR8 asked for "a filed follow-up". None is filed — the executor states it has no
Linear-write access this cycle and leaves it "TBD by the orchestrator/human". That is an
honest disclosure rather than a silent drop, so I am **not** blocking on it, but it is a
real outstanding action for the orchestrator (see Non-blocking Suggestions).

Also corrected this cycle and verified: the `tokenAuditSweep.css.test.ts` shift comment
(+26 → +59) and task 9.3's click count (30 → 25; the fresh e2e run prints exactly 25).

---

## Disclosed pre-commit bypass (repo policy: "if a bypass is used, call it out explicitly")

The executor self-disclosed one accidental `git commit -n` on **`72b0fc10`**
("Fix leaf-anchor tail attach (CR1) + sync reorder spec/schema (CR2)"), followed by manual
verification of all hooks against that tree before continuing on the normal hook path for
the five subsequent commits. **Naming it here per policy — this is a disclosed bypass, not
a hidden one**, and the disclosure was volunteered rather than discovered.

Verification: I re-ran the complete gate suite fresh against **HEAD (`ddbb90e9`)** and every
gate is green, so the tree that will actually merge is clean. I did not separately re-gate
`72b0fc10` in isolation; since this repo squash-merges, the merged artifact is the HEAD tree
I did verify, and the five later commits all went through the real hook path. I consider the
bypass adequately remediated and correctly disclosed.

---

### Phase 1: Spec Review — PASS

All five Cycle-1 spec issues are resolved: the reorder capability spec and JSON schema now
match the shipped trunk-only contract with a delta that will correct the live spec on
archive (CR2); the HEL-936 share was taken and documented as task 10.6 (CR3); design.md
decision 5's stated tail behavior is now actually met in the leaf case (CR1); task 10.4's
audit is accurate (CR8); and task 10.5's `outputDataTypeName` reinterpretation is retracted
with the live-code instance deleted.

One minor doc staleness, non-blocking: task **8.3** still says `usePipelineDetailPage.ts`
"still fetches `dataTypes` for the still-live legacy `ShapeInstantiateStep` panel wizard" —
that sentence was made false by this cycle's own CR3 deletion. Task 10.5/10.6 below it are
correct; only 8.3's clause is stale.

### Phase 2: Code Review — PASS

The eight CR fixes are, individually, well-targeted and fixed at the right layer rather than
patched at the symptom: CR1 at the repository primitive (plus the genuinely-necessary
`buildStepTree` half, correctly identified as a second independent cause); CR4 at the
clipping ancestor after correctly rejecting the z-index-only theory; CR5 via one shared
sentinel rather than two local band-aids. Comments explaining each fix state the reasoning
and the prior wrong belief, which is the behavior this repo's standards ask for. No new
lint/type/format violations, no dead code introduced, no `any` escape hatches, no
over-abstraction (the tabs pattern deliberately not extracted).

`attachTailInternal`'s `parentStepId` was also tightened to non-`Optional` per my Cycle-1
non-blocking suggestion.

Minor type-safety note (non-blocking): `selectOutputsForPipeline` casts the sentinel with
`EMPTY_OUTPUTS as Output[]`, widening a `readonly Output[]` to a mutable array to satisfy
the declared return type. Correct in practice (nothing mutates it) but the cast is the one
unguarded spot in an otherwise clean fix; declaring the selector's return type as
`readonly Output[]` would remove the need for it.

### Phase 3: UI Review — FAIL

Triggers matched (`frontend/**`, `schemas/**`, `openspec/specs/**`). Driven live at
`localhost:6340` / `:9247`.

- Happy path works end-to-end (create pipeline → filter step → leaf tail attach → Output
  with live ECharts preview → Save → live rail thumbnail).
- Loading/empty states intact; "No steps yet" uses the shared empty-state component.
- Console: no NEW errors; the 2 remaining `/api/types` 404s are the documented
  SidebarBody share and the `/schedule` 404 is the handled no-schedule case.
- Accessible names present on all rail chips, step controls and sheet fields; the tabs
  pattern is now complete and keyboard-navigable (CR6).
- Breakpoints 1440 / 1100 / 768 / 375: `scrollWidth === innerWidth` at every width, no
  layout breakage.
- Touch-target floor now passes under DESIGN.md's mandated bisection (CR4).
- **New defect found: the step river renders a tail under the wrong trunk node after a
  trunk-append, until the page is reloaded.** See CR9.

**Named historical invariants — re-verified NOT regressed:**

- **F-105** — `e2e/hel908-step-card-split.spec.ts` ("initial load fires /analyze once")
  passes fresh at this commit.
- **F-146** — now **genuinely** fixed, not partially: zero selector warnings across a full
  live session (CR5 above).
- **HEL-629** — unchanged this cycle; the remount-key path in `OutputPreviewPane.tsx` was
  only re-indented by CR7's className swap, and the pie↔bar switch case in
  `OutputEditorSheet.test.tsx` passes in the fresh Jest run.
- **HEL-681** — no evidence of regression; keyed/reconciled fetches unchanged.
- **HEL-878 / rail-thumbnail staleness** — re-verified live: immediately after Save, with no
  reopen, the chip reads `CHART / Untitled output / 3 rows`.

---

### Overall: FAIL

Eight of eight Cycle-1 change requests are genuinely resolved, each confirmed by fresh
first-hand evidence rather than by reading the diff. One new defect — surfaced by, and
newly reachable because of, CR1's own fix — blocks a pass.

---

### Change Requests

9. **A tail renders under the WRONG trunk node after appending a trunk step, until reload —
   stale local step state after the server-side splice reparents it.**
   Reproduced live at this commit (pipeline `381a9d0f`), immediately after CR1's own probe:
   1. `filter` (leaf) → `Add tail step` → `Group & aggregate`. Correct: aggregate at
      `position 1`, `parent = filter`, rendered as filter's tail.
   2. `+ Add transformation step` → `Sort rows`. The backend's `spliceInsertAtInternal`
      reparents the anchor's existing children onto the new step, so the persisted truth
      becomes:
      ```
      filter    79ac7e4c  position 0  parent null
      sort      11ffdbb5  position 0  parent 79ac7e4c   (new trunk continuation)
      aggregate 0606ccb1  position 1  parent 11ffdbb5   <-- tail now belongs to SORT
      ```
   3. But the page still renders (DOM, `.pipeline-detail-page__step-section` enumeration):
      ```
      section 0: [step-card "Filter rows"] [tail-chain "Group & aggregate"] [gap]
      section 1: [step-card "Sort rows"]   [add-tail-row]
      ```
      i.e. the aggregate tail is drawn under **Filter**, and **Sort** is drawn as having no
      tail — the exact inverse of the persisted data. A hard reload of the same URL renders
      it correctly (`section 0: Filter + add-tail-row`, `section 1: Sort + tail-chain`), which
      proves `buildStepTree` is right and the *local step array* is stale.
   Root cause (confirmed in code, not guessed):
   `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts:431-464` — `handleInsertStep`
   only swaps the temp step for the persisted one
   (`prev.map((s) => (s.id === tempStep.id ? pipelineStepToStep(persisted) : s))`). It never
   refreshes the *other* steps, whose `parentStepId`/`position` the server-side splice just
   mutated. The stale-`parentStepId` array is then fed to `buildStepTree`, which faithfully
   builds the wrong tree from wrong inputs.
   Why this is now blocking rather than pre-existing noise: CR1 made `position`/`parentStepId`
   load-bearing for single-child nodes in `buildStepTree`, and made leaf-tail-attach the modal
   way to create a tail. Before CR1 a leaf tail could not exist, so this combination was
   unreachable through the UI; it is now an ordinary two-step sequence. The user is shown a
   false claim about which node their aggregate reads from — with a `filter`/`limit` trunk
   step instead of `sort`, that is a materially different result — and nothing on the page
   corrects it until a reload.
   Fix: after the create call resolves in `handleInsertStep` (and check `handleAddTailStep` /
   `handleInstantiateShape` / `handleDuplicateStep` for the same exposure), reconcile the whole
   list rather than one element — `void dispatch(fetchPipelineSteps(id))` (already imported and
   used at :212), or have the create response return the full post-splice step list. Add
   regression coverage: a `stepTree`/hook-level test that a trunk-append after a leaf tail
   leaves the tail attached to the NEW trunk node, and an e2e assertion that the tail-chain
   sits in the last trunk step's section without an intervening reload.

### Non-blocking Suggestions

- Task **8.3** still asserts `usePipelineDetailPage.ts` "still fetches `dataTypes`" — made
  false by this cycle's own CR3 deletion. Correct that clause (tasks 10.5/10.6 are accurate).
- `selectOutputsForPipeline`'s `EMPTY_OUTPUTS as Output[]` cast: prefer declaring the return
  type `readonly Output[]` and dropping the cast.
- CR8's "filed follow-up" for splitting `usePipelineDetailPage.ts` (955) and
  `OutputEditorSheet.tsx` (569) still needs an actual ticket. The executor honestly disclosed
  it has no Linear-write access; this is an action for the orchestrator/human, and the record
  in tasks.md is adequate in the meantime.
- The 2 pre-existing ECharts `"Can't get DOM width or height"` warnings fire whenever the
  Output sheet's preview pane mounts before layout settles. Harmless, pre-existing, and out of
  this ticket's scope — but worth a spinoff if the console is ever expected to be clean.
- `HEL-937` should still name `MetricEditorForm.tsx` as a second live importer (carried over
  from Cycle 1; not re-checked this cycle as it was already dispositioned).
