# Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `b8e5341f` on top of `1c5edc44` (unchanged as history). Base `origin/main` @ `db51e936`.
Cumulative scope: **24 files, no frontend** — confirmed.

New commit touches 6 files: `JsonFlattener.scala` (4 lines, the FQN import fix only),
`MapAwareJsonFlatteningSpec.scala`, `SchemaInferenceEngineSpec.scala`, `SourceServiceSpec.scala` (new),
`files-modified.md`, `evaluation-1.md`.

### Phase 1: Spec Review — PASS

Both blocking Change Requests from evaluation-1.md are genuinely closed, verified by my own mutations rather than by
the executor's transcript. Task 4.4's requirement — the one that was marked `[x]` while unmet in cycle 1 — is now
actually implemented. Nothing this commit touched disturbed anything I passed in cycle 1 (spot-checks below).

Issues: none.

### Phase 2: Code Review — PASS

**Gates re-run fresh by me in `WORKTREE_PATH`** (`sbt test` from `backend/`, not root `npm test`; no `frontend/**`
file in the diff, so the frontend gates remain inapplicable):

- Run 1: `Total number of tests run: 4050`, `succeeded 4046, failed 4`.
- Run 2: `Total number of tests run: 4050`, `succeeded 4047, failed 3`, `Failed tests: com.helio.api.routes.auth.MfaApiRoutesSpec`.
- `node scripts/check-scala-quality.mjs`: exit 0, "clean (161 soft warning(s))" — reproduces.

**The 4050 total matches the executor's claim exactly. The green result does not — see the environmental section
below.** I established the failures are not this change's doing before treating them as non-blocking, and I did not
accept "flaky" on assertion.

#### CR1 — coverage-conjunct isolation: VERIFIED CLOSED

I ran four threshold mutations myself, not two:

| Mutation | Result | Reading |
| -- | -- | -- |
| `0.25 → 0.99` | **1 failed** — exactly `"boundary case: coverage ALONE decides STRUCT when intersection is empty"` | The gap I found in cycle 1 (this mutation was **all-green**, 17/17) is closed |
| `0.25 → 0.0` | 10 failed of 18 | Still red, as before |
| `0.25 → 0.4` | 18 passed | Bracket residual — see below, expected and acceptable |
| `coverage <` → `coverage >` (operator inversion) | 11 failed | The orchestrator's suggested third mutation is caught |

**The 0.99 failure is for the RIGHT reason, not incidentally.** The new fixture is four rows
(`{a,b,c} {b,c,d} {c,d,e} {d,e,f}`) whose **intersection is empty**, so the intersection conjunct structurally cannot
decide it — only coverage can. I recomputed its math independently: `union=6, coverage=0.5, intersection=0`. At
threshold 0.25 it is STRUCT because 0.5 > 0.25; at 0.99 it flips to MAP. That is a genuine coverage-decided
classification, which is precisely what was missing in cycle 1.

**The per-field pinning is computed, not copied from prose.** The test defines `coverageAndIntersection` /
`objectsAt` helpers and runs them over the loaded fixture rows (`txRows`, `projRows`), then asserts the measured
result against pinned constants with `+- 0.001`. A hardcoded number compared to nothing would prove nothing; this is a
measurement compared to an expectation. I re-derived all four independently from the committed fixture files:

```
settings 0.682/1   metadata 1.000/1   stats 0.580/16   player 1.000/14
```

All four match design.md D2 and the pinned test values.

**Stated residual (not a change request):** mutation `0.25 → 0.4` stays green. The guard now brackets the threshold
to the open interval **(0.2, 0.5)** — the MAP-side boundary fixture sits at coverage 0.2, the new STRUCT-side one at
0.5 — rather than pinning 0.25 exactly. That is the correct and normal way to guard a real-valued threshold; pinning
an exact float would require an arbitrary fixture at 0.2499. I note it so the guard's actual strength is on record
and not overstated. The executor did not claim more than this.

#### CR2 — D6 ordering: VERIFIED CLOSED

I re-ran **the exact mutation I used to find the gap**, so the comparison is direct:

| | Cycle 1 (`1c5edc44`) | Cycle 2 (`b8e5341f`) |
| -- | -- | -- |
| `previewRest` classifying over `jsRows.take(10)` | **full suite 4048/4048 GREEN** | **RED**: `Set(Set("m.shared")) was not equal to Set(Set("m")) (SourceServiceSpec.scala:595)`, 26 passed / 1 failed |

The gap is closed, and the failure message is exactly the one predicted.

**The test drives the real seam and does not reimplement what it checks.** I read it in full: it builds a 15-row
fixture, calls `svc.createRest(...)` (real inference) and `svc.preview(...)` (the real `previewRest` path via the
file's existing fake-connector pattern), then asserts on observable output only — `created.inferredSchema`'s field
names and `previewed.rows`' key sets. It computes no coverage, no intersection, and never calls `detectMapPaths`
itself. A test that recomputed the classification would prove nothing; this one doesn't.

**The fixture's divergence is real.** Independently recomputed: first 10 rows → `union=1, coverage=1.0,
intersection=1` (STRUCT, would emit `m.shared`); full 15 rows → `union=6, coverage=0.167, intersection=0` (MAP, emits
one `m`). The first-10 and full-batch classifications genuinely differ, which is the only way this seam can be
pinned.

**Both synthetic fixtures are declared synthetic with a stated, legitimate reason.** The CR2 fixture's comment
explains that a divergent-first-10 shape appears in none of the committed real payloads and hand-crafting is the only
way to hit the seam; the CR1 fixture's comment explains that every real struct has a non-empty intersection, so
isolating the coverage conjunct requires a synthetic empty-intersection case. Both reasons are correct — I verified
the underlying claims against the real fixtures. This is the legitimate use of synthetic data, not a retreat from the
HEL-904 real-data lesson.

#### Other verifications requested

- **`assertAgreement` is strengthened, not reshaped.** The only change is `Set.empty` → `JsonFlattener.detectMapPaths(rows.toVector)`
  plus a comment. Every assertion in the helper is untouched. This makes the helper able to detect a schema/row
  divergence on map-shaped input, which it previously could not — a strict strengthening.
- **The FQN fix complies with CONTRIBUTING.md.** `import scala.collection.mutable` at the top, `mutable.Set.empty[String]`
  at the use site — the idiomatic form, and it sidesteps the clash with the imported `Set`. Quality gate still exit 0.
- **files-modified.md baseline wording is corrected.** It now reads "the count is **3**, all in ONE suite" and
  explicitly labels the earlier "BOTH … failures" as a prose slip contradicted by its own pasted transcript. Accurate.
- **Cycle-1 spot-checks, undisturbed.** The production classifier, the three consumers' wiring, `MaxDepth`/`ListMap`/
  path-sort, and the four migrated specs' assertions are byte-identical to `1c5edc44` — the only production change in
  `b8e5341f` is the two-line import refactor, which is behavior-neutral (`mutable.Set` resolves to the same type).
  My baseline run of `MapAwareJsonFlatteningSpec` + `SourceServiceSpec` is 45/45 green (18 + 27), matching the
  executor's per-suite claims.

### Phase 3: UI Review — N/A

No trigger matched: `backend/src/**` and `openspec/changes/**` only. No `frontend/**`, `ApiRoutes.scala`,
`schemas/**`, or `openspec/specs/**`.

### Overall: PASS

---

## Environmental note — the full suite is NOT reliably green on this machine, and it is not this change's fault

This is the one place my measurement disagrees with the executor's report, so I am stating it precisely rather than
rounding it to "green".

The executor reported 4050/4050. **My two full runs were 4046/4050 and 4047/4050**, the second failing three tests all
in `com.helio.api.routes.auth.MfaApiRoutesSpec` ("reject once the attempt cap is reached", "return the un-enrolled
default for a user with no MFA row", "return 200 with a secret and matching otpauth URI").

Diagnosis, established rather than assumed:

1. **Green in isolation on the unmodified base.** `MfaApiRoutesSpec` alone at `origin/main` (`db51e936`, zero HEL-1015
   code, throwaway detached worktree): 17/17 green, twice.
2. **Green in isolation at the commit under review.** Same spec alone at `b8e5341f`: 17/17 green.
3. **Green in a full run of the previous commit.** My cycle-1 full run at `1c5edc44` was 4048/4048 with zero failures,
   so this is not deterministic.
4. **Disjoint blast radius.** MFA route specs exercise no path through `JsonFlattener`, `PipelineRowJson`,
   `SchemaInferenceEngine` or `SourceService.previewRest`, and the diff touches no file they load.
5. **Probable cause identified.** `ps` shows **three concurrent `sbt run` backend dev servers** alive from other
   worktrees (uptimes ~95, ~55 and ~23 minutes), all pointed at the shared dev Postgres — the documented shared-dev-DB
   contention hazard. A DB-touching route spec is exactly what that perturbs.

**Conclusion: not caused by HEL-1015, and not blocking.** It fails only in full-suite runs, only sometimes, and is
green in isolation on both the base and the change. I am flagging it because it is a live source of false gate
signals for every ticket running on this machine right now — not because it affects this one. Worth knowing that
"4050/4050" is achievable but not reproducible on demand while those dev servers are up.

## Non-blocking Suggestions

- The threshold guard brackets `MapCoverageThreshold` to (0.2, 0.5) rather than pinning 0.25 (mutation `0.4` passes).
  Fine as-is; if you ever want it tighter, a fixture near coverage 0.26 on the MAP side would narrow the lower bound.
- Carried forward from evaluation-1.md and still true, still non-blocking: test 4.5 guards divergence rather than
  classification. The executor added a comment saying exactly that, which resolves the readability concern I raised.

## Guardrail checks

- HEL-1009 remains disjoint; HEL-1012/1013/868/869/891/599 not absorbed; no migration or backfill; HEL-1030 still
  owns remediation. Unchanged from cycle 1 and untouched by `b8e5341f`.
- All mutations ran in throwaway `git worktree --detach` copies under the session scratchpad, never in the delivery
  worktree. Both removed with `git worktree remove --force` + `git worktree prune`; `git worktree list` shows no
  straggler of mine, and `git status --porcelain` in the delivery worktree is empty.
