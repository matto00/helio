## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `2bb5aeae41cc113159d54c0812eb467be42eeb71`. That is commit 2bb5aeae4 on top of the cycle-1 head
43453b36e. The base was resolved live as `5074b69377ea8ce1010739dddcf858448a3a0af5`.

The diff still touches only `docs/live-draft-preview.md` and `openspec/changes/live-draft-preview-spike/**`.
`evaluation-1.md` is committed unmodified: it is byte-identical to the persisted copy.

### Phase 1: Spec Review — PASS

I checked each cycle-1 change request against the tree.

- **CR1 (§12 preface and references): fixed.**
  - The `skeptic-design-1.md` sentence and the "orchestrator verifies wording" sentence are gone.
  - The intro now names `docs/live-draft-preview.md`, and every reference reads "`docs/live-draft-preview.md` §N".
  - §12 can be posted to Linear as is.
- **CR2–CR5 (verbatim ACs): fixed, not just reworded.**
  - I checked all five HEL-1581 AC lines from the scratchpad copy as exact substrings of §12 (`grep -F` on the quoted
    text). The result was VERBATIM for 5 of 5.
  - The mapping is now real:
    - **AC1** states the budget (< 50 ms; measured ~1 ms, and ~4-5 ms at 4x throttle). It also states the network-log
      assertion: zero requests over a burst of edits, including no per-edit PATCH.
    - **AC2** maps "debounced" to the single-flight, 300-400 ms trailing debounce and 600 ms floor in §6.3. It maps
      "pending state" to the per-step status, the stale frame and the live pill being off (§5/§7). It also states the
      wording adjustment from "HEL-505 limits" to a dedicated draft-preview limiter that never consumes the run guard.
    - **AC3** maps Discard and defines how "exactly" is tested: deep equality of the step list, configs, order,
      enabled flags, Output config and fingerprint, plus no request sent.
    - **AC4** keeps its mapping (it was already correct).
    - **AC5** is now consistent with §4. Lines 197-203 say every non-static source always shows the label and its
      capture age, even when the sample is exact. Only the count/aggregate caveat depends on the sample being a prefix.
- **CR8: fixed.** `tasks.md` 5.1 is `[x]`. Task 1.2 now names `measure.cjs` and explains why.
- **Constraints.** C1 and C2 are still honored. §14 is unchanged and verbatim. Rulings A, E and F are still reflected,
  and "Preview with AI" appears only as rejected or overridden.

### Phase 2: Code Review — PASS

**Gates (fresh run in the worktree):**

- `npm run format:check` passed: "All matched files use Prettier code style!".
- `npm run check:openspec` passed: "openspec/ is clean".
- No `frontend/**` or `backend/**` file changed, so lint, jest, build and sbt are not triggered.
- `git grep live-draft-preview -- frontend backend schemas shared-test-fixtures package.json` is empty.
- No changed file lies outside `docs/` and the change directory.

**CR6/CR7: the replacement parity mutations, probed on both runtimes.**

- *JVM:* I ran a jshell probe. It mirrors `CastStep.castValue` (Integer.parseInt, then a `(int) Double.parseDouble`
  fallback, else null). It also mirrors `SortStep.compareNonNullAsc`, which I re-read at `SortStep.scala`: tier 1 is
  finite numerics via `PipelineRowJson.toDouble`, numeric strings included, compared with `Double.compareTo`; tier 2
  is `toString` order; nulls go last.
- *Node:* `Number(s)`, a sort with `(x, y) => x - y`, and a default sort.

| Input | JVM | JS | Diverges? |
| --- | --- | --- | --- |
| `"0x10"` | null | 16 | yes |
| `"1.9"` | 1 | 1.9 | yes |
| `"Infinity"` | 2147483647 | `Infinity` | yes |
| mixed column `[10,"9","abc",null,"2",3.5,"Abc","10"]` | tier sort `[2, 3.5, 9, 10.0, 10, Abc, abc, null]` | `a - b` gives `["2",3.5,"9",10,"abc","Abc","10"]`; string sort gives `[10,"10","2",3.5,"9","Abc","abc"]` | yes, both mutations differ from the oracle |

- All of these match `measurements.md` §5 and §3.3 exactly. Each named mutation can now go red.
- The `-0.0` claim is withdrawn, with the right reason (JSON/`BigDecimal` has no signed zero).
- The §3.1 `cast` row now marks `"1e3"` and `" 5 "` as not traps.
- The executor's §5 probe used the real `SortStep`/`CastStep` through a temporary ScalaTest. My probe is an
  independent re-implementation from the source, and it agrees.

**Disputed drift note (cycle-1 suggestion): the executor is right, and I withdraw it.**

- `PipelineRunPreview.scala` is unchanged against the base.
- `grep -n` gives `:280` `.execute(pipeline, roots, slicedSteps...`, `:293` `allJsRows.take(10)` and `:297`
  `previewRows, totalCount, outcome.stepCounts, ...` (the per-step counts).
- All three citations at doc lines 48-49 are correct. My cycle-1 reading was off by one display window.

**Other cycle-1 suggestions:**

- `PatchSetUndoService.scala:43` is corrected.
- The §8.3 lock wording now says the cited `PipelineRepository.scala:514-520` locks *panel* rows, and that a
  pipeline-row lock is new.
- The `cd .../` commands now carry full paths.
- The "What" bullets are noted.
- The cold-state range is unified to "about 25-45 ms".

**New issues introduced by the edits: none blocking.** See the suggestions below.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed.

### Overall: PASS

### Non-blocking Suggestions

- **Raw probe ranges were rounded to match the prose.** `measurements.md` §2 changed measured figures, not just the
  prose. "26-46 ms in another" and "100 consecutive `auth/me` calls took 24-44 ms each" became "about 25-45 ms". The
  `docs/` prose can say "about 25-45 ms". The measurement record should keep the observed 24-44 / 26-46 values it
  reported, because evidence should not be rounded to fit a summary.
- **New ambiguity in the static-source label (§4, lines 199-203).** A CSV is classed as static and shows the plain
  "Static · 30 rows" label. Yet the same paragraph's prefix example ("first 1,000 of 12,431 rows", "a CSV prefix up to
  50,000 rows") is a CSV. State explicitly that a static source larger than 1,000 rows shows "first 1,000 of M rows"
  and the count/aggregate caveat, with no age.
- **Leftover build output.** `backend/target/.../test-classes/com/helio/domain/steps/TmpHel1580Probe.class` and its
  test report remain in the worktree. The source was deleted and not committed. This is ignored build output that
  zinc should prune on the next compile, and the worktree is torn down at Phase 4, but a `sbt clean` would remove any
  doubt if this worktree runs `testFull` again.
