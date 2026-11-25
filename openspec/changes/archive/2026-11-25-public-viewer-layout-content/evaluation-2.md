## Evaluation Report — Cycle 2 (evaluation-2.md)

**Commit reviewed:** HEAD `6e580521fd7d8ddaf270522ef8faf523f17fd78c`. The cycle-2 delta is `e4da3c8d1..6e580521f`; the review base is `95cec30cf`, resolved live.

**Setup:**
- The spawn-cwd guard returned READY.
- Every gate below is my own fresh run.
- I ran under the lane constraints: lane DB `helio_hel1587`, an empty `ANTHROPIC_API_KEY`, jest with 3 workers, Playwright with 2 workers and `sbt -J-Xmx3g`.
- My servers are stopped, and my throwaway user was deleted by exact id.

**Evidence directory:** `/home/matt/Development/helio/.concertino/runs/HEL-1587/evidence/.concertino/scratch/HEL-1587/`. Below, `<ev>` stands for this directory.

### Gates (fresh)

| Gate | Result |
| --- | --- |
| `npm ci` (frontend) | exit 0 |
| `npm run lint` / `format:check` / `typecheck` / `check:schemas` | all exit 0 |
| `npm test` | root: 76 suites / 683 tests; frontend: 951 suites / 11,073 tests (one more than cycle 1: the new CR1 test); all pass |
| `npm --prefix frontend run build` | exit 0 |
| sbt shard `com.helio.api.routes.dashboards.*`, `PublicPathRlsSmokeSpec`, `ApiRoutesSpec` | 436 passed; guard reports `failed=0 aborted=0` |
| Playwright, dev project: `hel1587-public-viewer-layout` + `hel1744-insight-panel` | 7/7 passed |

The backend delta in this cycle is only an import re-grouping in `PublicDashboardRoutes.scala`, and the shard above compiles and exercises it. I did not re-run the executor's 3,033-test `com.helio.api.*` run. My cycle-1 shards (788 tests over the same touched packages) plus this shard cover the changed code.

### Phase 1: Spec Review — PASS

Nothing in scope changed since cycle 1, which passed this phase.

- The planning artifacts are unchanged, apart from `files-modified.md`, which now records the `measureBeforeMount` change.
- The cycle-1 report is committed in the change dir as `evaluation-1.md`, which is the expected place.

### Phase 2: Code Review — PASS

Each cycle-1 change request, checked:

1. **CR1, phone double mount: fixed.**
   - **The code:** `PublicDashboardContent` now calls `useContainerWidth({ measureBeforeMount: true })` and renders nothing inside the measured wrapper until `mounted`.
   - **The wrapper `div` with `containerRef` is always rendered,** so the measurement still attaches.
   - **The jest mock now reproduces the real react-grid-layout 2.2.4 contract.** It starts at 1280 with `mounted` set to the inverse of `measureBeforeMount`, then measures in a passive effect.
   - **The new test** ("mounts each panel body once on a phone cold load") asserts the stack is present, the grid is absent, and rows, meta and form-schema are each called exactly once.
   - **Recorded red:** before the fix the test received 2 calls where it expected 1. That matches what the mock predicts for the old code.
   - **Recorded mutation:** removing `measureBeforeMount` turns the test red again.
2. **CR2, dead CSS: fixed.** The `.public-dashboard-viewer__panel-kind` rule is removed, and no reference to it remains.
3. **CR3, mutation evidence: present** in `mutation-evidence.txt` under CYCLE 2.
   - **(a) RLS-alone run.** Only the owner predicate was removed and `withUserContext` was kept. The result was 10 succeeded and 1 failed, out of 11 tests (`PublicFormSchemaRlsSpec` has 2, `PublicLayoutAndFormSchemaRoutesSpec` has 9):
     - the single failure is the BYPASSRLS route-spec case, as designed;
     - so both NOBYPASSRLS cases ran and stayed green, meaning RLS alone yields 404.
   - **(b) Assertion-level reds:**

     | Mutation | Result |
     | --- | --- |
     | Grid forced to the stack | 7 grid tests red |
     | Content reverted to title + type name | 11 red, including the content-renderers test |
     | `storedLayoutFor` filter dropped | stale-ids case red |
     | Bound-field filter dropped | route spec red, plus the RLS owner-positive case |

   - The hostile-markdown jest case is now labelled as a GUARD.
4. **Import grouping** in `PublicDashboardRoutes.scala` is tidied, as cycle 1 suggested.

No new issues: no FQNs, no dead code and no new escape hatches. Files stay within budget.

### Phase 3: UI Review — PASS

Lane servers were started by me through `start-servers.sh` after the commit: started 13:35, commit at 13:19. The seeded board has an output, a markdown panel, an image and a form, laid out in two columns, with a share token.

**Phone cold load re-measured live** (dev build, where StrictMode doubles every request):

| Viewport | `/panels` | form-schema | output-meta | rows | Notes |
| --- | --- | --- | --- | --- | --- |
| 375 px (this cycle) | x2 | x2 | x2 | x2 | stack rendered, no `.react-grid-layout` in the DOM |
| 375 px (cycle 1) | | x4 | x4 | x4 | |
| 1440 px | | | | | grid rendered, processed width 1408 px (md) |

- The remaining x2 is StrictMode alone. A production phone cold load therefore makes one request per panel body.
- Evidence: `<ev>/eval-2-phone-cold-load.txt`.

**Resizes:** 375 px → 1700 px resolved lg with a correct two-column render.
- Content had settled 3 s after the resize: rows, form preview and image all present, no skeletons left (`<ev>/eval2-public-1700.png` caught the bodies mid-load).
- Crossing the 768 px threshold remounts the bodies (stack ↔ grid), which is by design and not a cold-load path.

**Console:** no errors or warnings on the public page in any flow.

**Unchanged from cycle 1:** layout, content, form preview, accessibility and the two-theme comparison against the signed-in grid. The cycle-2 delta touches none of them, and the e2e re-ran both themes at 375 and 1440 px and passed.

The card-footer and provenance-row placement remains a visual [judgment] call for the skeptic.

### Overall: PASS

### Non-blocking Suggestions

- The phone stack is in API order, not xs layout order. This is the existing behaviour and allowed by the AC; it is a follow-up candidate.
- The shared `ImagePanel` empty state reads "Open panel settings to configure." That wording is an edit instruction, shown to anonymous viewers. A read-only variant of the copy would fit the public viewer; this is a follow-up candidate.
- File the pre-existing public `config.dataSourceId` exposure at Delivery, as committed in the design.
